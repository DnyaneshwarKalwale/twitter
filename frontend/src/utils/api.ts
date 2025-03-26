import { TwitterResponse, Tweet, Thread } from './types';
import { toast } from '@/hooks/use-toast';

// API configuration
const RAPID_API_KEY = '20efe22d0cmsh1570fafd899bed9p112e68jsn3763ca45ca50';
const RAPID_API_HOST = 'twitter154.p.rapidapi.com';
const BACKEND_API_URL = 'https://twitter-aee7.onrender.com/api/tweets';

// Cache for API responses
const API_CACHE = {
  tweetDetails: new Map<string, Tweet>(),
  userTweets: new Map<string, Tweet[]>(),
  failedRequests: new Map<string, {
    timestamp: number,
    errorCode: number,
    retryAfter?: number
  }>()
};

// Rate limiting
const MIN_API_CALL_INTERVAL = 2000;
const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;
const FAILED_REQUEST_EXPIRY = 10 * 60 * 1000;

let lastApiCallTime = 0;
const requestQueue: (() => Promise<any>)[] = [];
let isProcessingQueue = false;

// Helper functions
const rateLimit = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  
  if (timeSinceLastCall < MIN_API_CALL_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_API_CALL_INTERVAL - timeSinceLastCall));
  }
  lastApiCallTime = Date.now();
};

const processQueue = async () => {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;
  
  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (request) {
      try {
        await request();
        await rateLimit();
      } catch (error) {
        console.error('Error processing queued request:', error);
      }
    }
  }
  isProcessingQueue = false;
};

const queueRequest = (request: () => Promise<any>): Promise<any> => {
  return new Promise((resolve, reject) => {
    const wrappedRequest = async () => {
      try {
        const result = await request();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    requestQueue.push(wrappedRequest);
    processQueue();
  });
};

const hasRecentlyFailed = (url: string): boolean => {
  const failedRequest = API_CACHE.failedRequests.get(url);
  if (!failedRequest) return false;
  
  const now = Date.now();
  if (now - failedRequest.timestamp > FAILED_REQUEST_EXPIRY) {
    API_CACHE.failedRequests.delete(url);
    return false;
  }
  
  if (failedRequest.retryAfter && now > failedRequest.retryAfter) {
    API_CACHE.failedRequests.delete(url);
    return false;
  }
  
  return true;
};

const recordFailedRequest = (url: string, errorCode: number, retryAfter?: number) => {
  API_CACHE.failedRequests.set(url, {
    timestamp: Date.now(),
    errorCode,
    retryAfter: retryAfter ? Date.now() + retryAfter : undefined
  });
  
  // Clean up old failed requests
  for (const [key, value] of API_CACHE.failedRequests.entries()) {
    if (Date.now() - value.timestamp > FAILED_REQUEST_EXPIRY) {
      API_CACHE.failedRequests.delete(key);
    }
  }
};

// API request function with retry logic
const makeApiRequest = async (url: string, retryCount = 0): Promise<any> => {
  if (hasRecentlyFailed(url)) {
    throw new Error(`Skipping recently failed request to: ${url}`);
  }
  
  const executeRequest = async (): Promise<any> => {
        await rateLimit();
        
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.withCredentials = true;
        
        xhr.addEventListener('readystatechange', function() {
          if (this.readyState === this.DONE) {
            if (this.status >= 200 && this.status < 300) {
              try {
              resolve(JSON.parse(this.responseText));
              } catch (error) {
                reject(new Error(`Failed to parse response: ${error}`));
              }
            } else if (this.status === 429 && retryCount < MAX_RETRIES) {
              const delay = RETRY_DELAY * Math.pow(2, retryCount);
              console.warn(`Rate limited (429). Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
              
              setTimeout(() => {
                makeApiRequest(url, retryCount + 1)
                  .then(resolve)
                  .catch(reject);
              }, delay);
            } else {
              if (this.status === 429) {
              recordFailedRequest(url, this.status, 60000);
              } else {
                recordFailedRequest(url, this.status);
              }
              reject(new Error(`API error: ${this.status}`));
            }
          }
        });
        
        xhr.open('GET', url);
        xhr.setRequestHeader('x-rapidapi-key', RAPID_API_KEY);
        xhr.setRequestHeader('x-rapidapi-host', RAPID_API_HOST);
        xhr.send(null);
    });
  };
  
  return retryCount > 0 ? executeRequest() : queueRequest(executeRequest);
};

// Improved thread detection
const detectTruncatedText = (text: string): boolean => {
  if (!text || text.trim().length === 0) return false;
  
  // Obvious truncation indicators
  if (text.endsWith('…') || text.endsWith('...')) return true;
  if (text.includes('… https://') || text.includes('... https://')) return true;
  
  // Check for abrupt endings
  const lastWords = text.trim().split(/\s+/).slice(-2);
  const commonTruncationEnders = ['the', 'a', 'an', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'like', 'of', 'all'];
  if (lastWords.length > 0 && commonTruncationEnders.includes(lastWords[lastWords.length - 1].toLowerCase())) {
    return true;
  }
  
  // Check for non-Latin scripts
  const hasNonLatinScript = /[\u0900-\u097F\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(text);
  const thresholdLength = hasNonLatinScript ? 180 : 240;
  
  if (text.length >= thresholdLength && !/[.!?"]$/.test(text.trim())) {
      return true;
  }
  
  return false;
};

// Enhanced tweet processing
const processTweet = (tweet: any): Tweet => {
    const textContent = tweet.extended_text || tweet.extended_tweet?.full_text || tweet.full_text || tweet.text || '';
    const isLikelyTruncated = detectTruncatedText(textContent);
    
  // Handle media
    const mediaUrls = [
      ...(tweet.media_urls || []),
      ...(tweet.extended_entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || []),
      ...(tweet.entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || [])
    ].filter(Boolean);
    
  // Process media items
  const processedMedia = mediaUrls.map((url: string, i: number) => {
    const isVideo = url.includes('.mp4') || url.includes('/video/');
    const isGif = url.includes('.gif');
    
    return {
      media_key: `media-${tweet.tweet_id}-${i}`,
      type: isVideo ? 'video' as const : isGif ? 'animated_gif' as const : 'photo' as const,
      url: url,
      preview_image_url: tweet.extended_entities?.media?.[0]?.media_url_https || url,
    };
  });

  // Clean text
  let cleanedText = textContent
    .replace(/\s*https:\/\/t\.co\/\w+$/g, '')
    .replace(/(\s*[…\.]{3,})$/g, '')
    .replace(/\n{3,}/g, '\n\n');
    
    return {
      id: tweet.tweet_id,
      text: tweet.text || '',
      full_text: cleanedText,
      created_at: tweet.creation_date,
      author: {
      id: tweet.user?.user_id,
      name: tweet.user?.name,
      username: tweet.user?.username,
      profile_image_url: tweet.user?.profile_pic_url
    },
    reply_count: tweet.reply_count || 0,
    retweet_count: tweet.retweet_count || 0,
    favorite_count: tweet.favorite_count || 0,
    quote_count: tweet.quote_count || 0,
    media: processedMedia,
    conversation_id: tweet.conversation_id || tweet.tweet_id,
      in_reply_to_user_id: tweet.in_reply_to_user_id,
      in_reply_to_tweet_id: tweet.in_reply_to_tweet_id,
    is_long: textContent.length > 280 || isLikelyTruncated,
    thread_id: tweet.conversation_id || tweet.tweet_id,
  };
};

// Fetch all replies for a tweet to build complete threads
const fetchAllReplies = async (tweetId: string, username: string): Promise<Tweet[]> => {
  const allReplies: Tweet[] = [];
  let continuationToken: string | null = null;
  let attempts = 0;
  const MAX_REPLIES_ATTEMPTS = 5; // Increased from 3 to ensure we get more thread tweets
  const uniqueReplyIds = new Set<string>();
  const authorUsername = username.toLowerCase();

  do {
    try {
      const url = continuationToken 
        ? `https://twitter154.p.rapidapi.com/tweet/replies/continuation?tweet_id=${tweetId}&continuation_token=${encodeURIComponent(continuationToken)}`
        : `https://twitter154.p.rapidapi.com/tweet/replies?tweet_id=${tweetId}`;

      const response = await makeApiRequest(url);
      
      if (response?.replies?.length) {
        const processed = response.replies
          .map(processTweet)
          .filter((t: Tweet) => {
            // Only include replies from the original author or direct replies to their tweets
            const isAuthor = t.author.username.toLowerCase() === authorUsername;
            const isReplyToAuthor = t.in_reply_to_user_id && 
              response.replies.some(r => 
                r.user?.user_id === t.in_reply_to_user_id && 
                r.user?.username.toLowerCase() === authorUsername
              );
            
            const isUnique = !uniqueReplyIds.has(t.id);
            if (isUnique) uniqueReplyIds.add(t.id);
            
            // Include only the author's tweets or direct replies to the author's tweets
            return isUnique && (isAuthor || isReplyToAuthor);
          });
        
        allReplies.push(...processed);
      }

      continuationToken = response?.continuation_token || null;
      attempts++;

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error fetching replies for tweet ${tweetId}:`, error);
      break;
    }
  } while (continuationToken && attempts < MAX_REPLIES_ATTEMPTS);

  // Sort replies chronologically
  allReplies.sort((a, b) => {
    const dateA = new Date(a.created_at).getTime();
    const dateB = new Date(b.created_at).getTime();
    return dateA - dateB; // Oldest first
  });

  return allReplies;
};

// Improved function to fetch tweet thread
const fetchFullThread = async (tweetId: string, username: string): Promise<Tweet[]> => {
  // Start with an empty array to collect all tweets in the thread
  const threadTweets: Tweet[] = [];
  const processedIds = new Set<string>();
  let currentTweetId = tweetId;
  let attempts = 0;
  const MAX_THREAD_ATTEMPTS = 10; // Limit to prevent infinite loops
  
  // First, try to get the root tweet of the thread by following the in_reply_to chain
  while (currentTweetId && attempts < MAX_THREAD_ATTEMPTS) {
    try {
      const tweet = await fetchTweetDetails(currentTweetId);
      if (!tweet) break;
      
      // Add this tweet to our collection if it's from the right author
      if (tweet.author.username.toLowerCase() === username.toLowerCase()) {
        if (!processedIds.has(tweet.id)) {
          threadTweets.unshift(tweet); // Add to beginning since we're going backward
          processedIds.add(tweet.id);
        }
      }
      
      // If this tweet is a reply, move to the parent tweet
      if (tweet.in_reply_to_tweet_id) {
        currentTweetId = tweet.in_reply_to_tweet_id;
      } else {
        // We've reached the root tweet
        break;
      }
      
      attempts++;
    } catch (error) {
      console.error(`Error fetching tweet ${currentTweetId} in thread:`, error);
      break;
    }
  }
  
  // Now get all replies to the root tweet (which should be first in our array now)
  if (threadTweets.length > 0) {
    const rootTweetId = threadTweets[0].id;
    const replies = await fetchAllReplies(rootTweetId, username);
    
    // Add any replies we don't already have
    replies.forEach(reply => {
      if (!processedIds.has(reply.id) && 
          reply.author.username.toLowerCase() === username.toLowerCase()) {
        threadTweets.push(reply);
        processedIds.add(reply.id);
      }
    });
    
    // Sort all tweets chronologically
    threadTweets.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateA - dateB; // Oldest first
    });
  }
  
  return threadTweets;
};

// Main function to fetch user tweets with complete threads
export const fetchUserTweets = async (username: string): Promise<Tweet[]> => {
  try {
    const cacheKey = username.toLowerCase();
    if (API_CACHE.userTweets.has(cacheKey)) {
      return API_CACHE.userTweets.get(cacheKey) || [];
    }
    
    // Get user ID first
    const userData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/details?username=${username}`);
    const userId = userData.user_id;
    if (!userId) throw new Error(`Could not find user ID for @${username}`);

    // Initial fetch with more tweets to ensure we get complete threads
    const initialData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/tweets?username=${username}&limit=100&user_id=${userId}&include_replies=true&include_pinned=false&includeFulltext=true`);
    
    // Process and filter tweets by author
    let allTweets = processTweets(initialData)
      .filter(tweet => tweet.author.username.toLowerCase() === username.toLowerCase());

    // Create a Set to track unique tweet IDs
    const uniqueTweetIds = new Set<string>();
    allTweets.forEach(tweet => uniqueTweetIds.add(tweet.id));

    // Create a list to store potential thread root tweets
    const potentialThreadRoots = allTweets.filter(tweet => 
      // Tweet has replies or is a reply
      tweet.reply_count > 0 || tweet.in_reply_to_tweet_id || 
      // Tweet text suggests it's part of a thread
      tweet.is_long
    );

    console.log(`Found ${potentialThreadRoots.length} potential thread tweets`);

    // For each potential thread root, fetch the complete thread
    const threadPromises = potentialThreadRoots.map(async tweet => {
      try {
        // Get the root tweet ID (either this tweet or the tweet it's replying to)
        let rootTweetId = tweet.id;
        
        // If this is a reply, we need to find the thread root
        if (tweet.in_reply_to_tweet_id) {
          // Try to follow the reply chain to find the root
          rootTweetId = tweet.in_reply_to_tweet_id;
          
          // Check if the parent is by the same author
          try {
            const parentTweet = await fetchTweetDetails(rootTweetId);
            if (parentTweet && 
                parentTweet.author.username.toLowerCase() === username.toLowerCase()) {
              // This is part of a self-thread, use the parent as the root
              rootTweetId = parentTweet.id;
            } else {
              // This is a reply to someone else, use the original tweet as root
              rootTweetId = tweet.id;
            }
          } catch (error) {
            console.error(`Error fetching parent tweet ${rootTweetId}:`, error);
            rootTweetId = tweet.id; // Fallback to original tweet
          }
        }
        
        // Fetch the complete thread for this root
        const fullThread = await fetchFullThread(rootTweetId, username);
        
        // Filter out any tweets we already have
        return fullThread.filter(t => !uniqueTweetIds.has(t.id) || t.id === tweet.id);
      } catch (error) {
        console.error(`Error processing thread for tweet ${tweet.id}:`, error);
        return [tweet]; // Return the original tweet if there's an error
      }
    });

    // Wait for all threads to be fetched
    const threadResults = await Promise.all(threadPromises);
    
    // Add all the new thread tweets to our collection
    threadResults.forEach(threadTweets => {
      threadTweets.forEach(tweet => {
        if (!uniqueTweetIds.has(tweet.id)) {
          uniqueTweetIds.add(tweet.id);
          allTweets.push(tweet);
        }
      });
    });

    // Fetch more tweets if we have continuation token
    let continuationToken = initialData.continuation_token;
    let continuationAttempts = 0;
    const MAX_PAGINATION_ATTEMPTS = 3;

    while (continuationToken && allTweets.length < 200 && continuationAttempts < MAX_PAGINATION_ATTEMPTS) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const continuationData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/tweets/continuation?username=${username}&continuation_token=${continuationToken}&user_id=${userId}`);
        
        const additionalTweets = processTweets(continuationData)
          .filter(tweet => {
            const isAuthor = tweet.author.username.toLowerCase() === username.toLowerCase();
            const isUnique = !uniqueTweetIds.has(tweet.id);
            if (isUnique && isAuthor) uniqueTweetIds.add(tweet.id);
            return isAuthor && isUnique;
          });
        
        allTweets.push(...additionalTweets);
        continuationToken = continuationData.continuation_token;
        continuationAttempts++;
      } catch (error) {
        console.error('Error fetching continuation tweets:', error);
        break;
      }
    }

    // Sort all tweets by creation date (newest first)
    allTweets.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA;
    });

    // Cache and return results
    API_CACHE.userTweets.set(cacheKey, allTweets);
    return allTweets;
  } catch (error) {
    console.error('Error fetching tweets:', error);
    toast({
      title: 'Error',
      description: 'Failed to fetch tweets. Please try again.',
      variant: 'destructive',
    });
    return [];
  }
};

// Process tweets from API response
const processTweets = (response: any): Tweet[] => {
  if (!response.results || !Array.isArray(response.results)) return [];
  
  return response.results.map(processTweet);
};

// Group tweets into threads
export const groupThreads = (tweets: Tweet[]): (Tweet | Thread)[] => {
  console.log('Starting groupThreads with', tweets.length, 'tweets');
  
  // Create maps for tracking
  const threadMap = new Map<string, Tweet[]>();
  const standaloneTweets: Tweet[] = [];
  const tweetMap = new Map<string, Tweet>();
  const processedTweetIds = new Set<string>();
  const authorThreadMap = new Map<string, Set<string>>();  // Map author to their thread IDs
  
  // Map tweets by ID
  tweets.forEach(tweet => {
    tweetMap.set(tweet.id, tweet);
    
    // Group tweets by conversation ID or thread ID
    const threadId = tweet.thread_id || tweet.conversation_id || tweet.id;
    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, []);
    }
    threadMap.get(threadId)?.push(tweet);
    
    // Map author to threads
    const authorUsername = tweet.author.username.toLowerCase();
    if (!authorThreadMap.has(authorUsername)) {
      authorThreadMap.set(authorUsername, new Set());
    }
    authorThreadMap.get(authorUsername)?.add(threadId);
  });

  // Build collection of thread root tweets
  const rootTweets = new Map<string, Tweet>();
  
  // First, identify potential root tweets (not replies or first tweet in reply chain)
  tweets.forEach(tweet => {
    // If it's not a reply or we don't have the parent tweet, it's a potential root
    if (!tweet.in_reply_to_tweet_id || !tweetMap.has(tweet.in_reply_to_tweet_id)) {
      const threadId = tweet.thread_id || tweet.conversation_id || tweet.id;
      // Only add if we don't already have a root for this thread
      if (!rootTweets.has(threadId)) {
        rootTweets.set(threadId, tweet);
      } else {
        // If this tweet is older than the existing root, replace it
        const existingRoot = rootTweets.get(threadId)!;
        const existingDate = new Date(existingRoot.created_at).getTime();
        const newDate = new Date(tweet.created_at).getTime();
        if (newDate < existingDate) {
          rootTweets.set(threadId, tweet);
        }
      }
    }
  });
  
  console.log('Found', rootTweets.size, 'root tweets');
  
  // Create thread objects from the root tweets
  const threads: Thread[] = [];
  const finalThreadMap = new Map<string, string>();  // Maps tweet ID to thread ID
  
  rootTweets.forEach((rootTweet, threadId) => {
    if (processedTweetIds.has(rootTweet.id)) return;
    
    // Get all tweets in this thread
    const threadTweets = threadMap.get(threadId) || [];
    const authorUsername = rootTweet.author.username.toLowerCase();
    
    // Filter to just tweets from the same author that aren't processed yet
    const authorThreadTweets = threadTweets.filter(t => {
      return t.author.username.toLowerCase() === authorUsername && 
             !processedTweetIds.has(t.id);
    });
    
    if (authorThreadTweets.length > 1) {
      // We have a real thread with multiple tweets from the same author
      
      // Sort chronologically
      authorThreadTweets.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateA - dateB;  // Oldest first
      });
      
      // Apply thread positions and mark as processed
      authorThreadTweets.forEach((t, i) => {
        t.thread_position = i;
        t.thread_index = i;
        processedTweetIds.add(t.id);
        finalThreadMap.set(t.id, threadId);
      });
      
      // Create the thread object
      threads.push({
        id: threadId,
        tweets: authorThreadTweets,
        author: rootTweet.author,
        created_at: rootTweet.created_at
      });
    } else if (authorThreadTweets.length === 1) {
      // Just a single tweet, not a thread
      processedTweetIds.add(rootTweet.id);
      standaloneTweets.push(rootTweet);
    }
  });
  
  console.log('Created', threads.length, 'threads with', 
    threads.reduce((acc, thread) => acc + thread.tweets.length, 0), 'total tweets');
  
  // Add any remaining unprocessed tweets as standalone
  tweets.forEach(tweet => {
    if (!processedTweetIds.has(tweet.id)) {
      processedTweetIds.add(tweet.id);
      standaloneTweets.push(tweet);
    }
  });
  
  console.log('Added', standaloneTweets.length, 'standalone tweets');
  
  // Sort threads by newest first
  const sortedThreads = threads.sort((a, b) => {
    const dateA = new Date(a.created_at || '').getTime();
    const dateB = new Date(b.created_at || '').getTime();
    if (isNaN(dateA) || isNaN(dateB)) {
      // Fallback to using the ID of the first tweet
      return Number(BigInt(b.tweets[0].id) - BigInt(a.tweets[0].id));
    }
    return dateB - dateA;
  });
  
  // Sort standalone tweets by newest first
  const sortedStandaloneTweets = standaloneTweets.sort((a, b) => {
    const dateA = new Date(a.created_at).getTime();
    const dateB = new Date(b.created_at).getTime();
    if (isNaN(dateA) || isNaN(dateB)) {
      return Number(BigInt(b.id) - BigInt(a.id));
    }
    return dateB - dateA;
  });
  
  const result = [...sortedThreads, ...sortedStandaloneTweets];
  console.log('Final result has', result.length, 'items');
  
  return result;
};

// Other API functions (saveSelectedTweets, fetchTweetDetails, etc.) remain similar to original
// but can be simplified using the new processTweet function

export const fetchTweetDetails = async (tweetId: string, isSaved: boolean = false): Promise<Tweet | null> => {
  if (!tweetId) return null;

  try {
    if (API_CACHE.tweetDetails.has(tweetId)) {
      return API_CACHE.tweetDetails.get(tweetId) || null;
    }

    const url = `https://twitter154.p.rapidapi.com/tweet/details?tweet_id=${tweetId}`;
    if (hasRecentlyFailed(url)) return null;

    const data = await makeApiRequest(url);
    if (!data) return null;

    const processedTweet = processTweet(data);
    API_CACHE.tweetDetails.set(tweetId, processedTweet);
    return processedTweet;
  } catch (error) {
    console.error('Error fetching tweet details:', error);
    return null;
  }
};

export const fetchTweetContinuation = async (tweetId: string, isSaved: boolean = false): Promise<Tweet | null> => {
  if (!tweetId) return null;

  try {
    const url = `https://twitter154.p.rapidapi.com/tweet/continuation?tweet_id=${tweetId}`;
    if (hasRecentlyFailed(url)) return null;

    const data = await makeApiRequest(url);
    if (!data) return null;

    return processTweet(data);
  } catch (error) {
    console.error('Error fetching tweet continuation:', error);
    return null;
  }
};

export const saveSelectedTweets = async (tweets: Tweet[], username: string = 'anonymous'): Promise<boolean> => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        tweets, 
        username, 
        options: {
          preserveExisting: true,
          skipDuplicates: true,
          preserveThreadOrder: true
        }
      }),
    });

    if (!response.ok) throw new Error(`Error saving tweets: ${response.status}`);

    const data = await response.json();
    toast({
      title: 'Tweets Saved',
      description: data.skippedCount 
        ? `${data.count} tweets saved. ${data.skippedCount} duplicates skipped.` 
        : `${data.count} tweets saved to database.`,
    });
    
    return true;
  } catch (error) {
    console.error('Error saving tweets:', error);
    toast({
      title: 'Error',
      description: 'Failed to save selected tweets to database.',
      variant: 'destructive',
    });
    return false;
  }
};

// New function to fetch tweets from a list
export const fetchListTweets = async (listId: string, limit: number = 150): Promise<Tweet[]> => {
  try {
    // Initial fetch with increased limit
    const initialData = await makeApiRequest(`https://twitter154.p.rapidapi.com/lists/tweets?list_id=${listId}&limit=100`);
    
    // Process and filter tweets
    let allTweets = processTweets(initialData);

    // Create a Set to track unique tweet IDs
    const uniqueTweetIds = new Set<string>();
    allTweets.forEach(tweet => uniqueTweetIds.add(tweet.id));

    // Fetch more tweets if we have continuation token
    let continuationToken = initialData.continuation_token;
    let continuationAttempts = 0;
    const MAX_LIST_PAGINATION_ATTEMPTS = 5; // Increased to get more tweets

    while (continuationToken && allTweets.length < limit && continuationAttempts < MAX_LIST_PAGINATION_ATTEMPTS) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const continuationData = await makeApiRequest(
          `https://twitter154.p.rapidapi.com/lists/tweets/continuation?list_id=${listId}&limit=100&continuation_token=${encodeURIComponent(continuationToken)}`
        );
        
        if (!continuationData || !continuationData.results) {
          console.log('No more tweets available in continuation');
          break;
        }

        const additionalTweets = processTweets(continuationData)
          .filter(tweet => {
            const isUnique = !uniqueTweetIds.has(tweet.id);
            if (isUnique) uniqueTweetIds.add(tweet.id);
            return isUnique;
          });
        
        if (additionalTweets.length === 0) {
          console.log('No new unique tweets found in continuation');
          break;
        }

        allTweets.push(...additionalTweets);
        continuationToken = continuationData.continuation_token;
        continuationAttempts++;

        console.log(`Fetched ${allTweets.length} tweets so far, continuing...`);
      } catch (error) {
        console.error('Error fetching continuation tweets:', error);
        break;
      }
    }

    console.log(`Total tweets fetched: ${allTweets.length}`);

    // Sort all tweets by creation date (newest first)
    allTweets.sort((a, b) => {
      try {
        // Parse dates more carefully to ensure correct ordering
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        
        // If dates can't be parsed correctly, fall back to ID-based ordering
        if (isNaN(dateA) || isNaN(dateB)) {
          // Use tweet IDs which are chronological in Twitter's system
          return Number(BigInt(b.id) - BigInt(a.id));
        }
        
        return dateB - dateA; // Newest first
      } catch (e) {
        // Fallback to ID comparison if date parsing fails
        return Number(BigInt(b.id) - BigInt(a.id));
      }
    });

    // Group tweets into threads
    const threads = groupThreads(allTweets);

    // Sort threads by their first tweet's date (newest first)
    threads.sort((a, b) => {
      try {
        const dateA = new Date(a.created_at || '').getTime();
        const dateB = new Date(b.created_at || '').getTime();
        if (isNaN(dateA) || isNaN(dateB)) {
          // If dates can't be parsed, sort threads so most recent tweets appear first
          // Using the ID of the first tweet in each thread
          const aTweets = 'tweets' in a ? a.tweets : [a];
          const bTweets = 'tweets' in b ? b.tweets : [b];
          return Number(BigInt(bTweets[0].id) - BigInt(aTweets[0].id));
        }
        return dateB - dateA;
      } catch (e) {
        // Fallback to first tweet ID comparison
        const aTweets = 'tweets' in a ? a.tweets : [a];
        const bTweets = 'tweets' in b ? b.tweets : [b];
        return Number(BigInt(bTweets[0].id) - BigInt(aTweets[0].id));
      }
    });

    // Flatten threads back into tweets while maintaining order
    const orderedTweets = threads.flatMap(item => {
      if ('tweets' in item) {
        // This is a thread
        return item.tweets;
      } else {
        // This is a standalone tweet
        return [item];
      }
    });

    return orderedTweets;
  } catch (error) {
    console.error('Error fetching list tweets:', error);
    toast({
      title: 'Error',
      description: 'Failed to fetch list tweets. Please try again.',
      variant: 'destructive',
    });
    return [];
  }
};