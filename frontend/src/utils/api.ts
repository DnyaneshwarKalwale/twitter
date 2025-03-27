import { TwitterResponse, Tweet, Thread } from './types';
import { toast } from '@/hooks/use-toast';

// API configuration
const RAPID_API_KEY = 'ff2ad2f80cmshaba9a69f647c7e1p16d310jsn3465a4537433';
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

// User configurable options
export const TwitterConfig = {
  fetchLimit: 50, // Default number of tweets to fetch initially
  maxTweets: 200, // Maximum number of tweets to fetch in total
  threadsToProcess: 10, // Number of threads to process for replies
  maxContinuations: 3, // Maximum number of continuation fetches
  replyMaxPages: 4, // Maximum number of pages when fetching replies
  retryDelay: 3000, // Delay between retries in ms
  setFetchLimit: (limit: number) => {
    if (limit > 0 && limit <= 100) {
      TwitterConfig.fetchLimit = limit;
    }
  },
  setMaxTweets: (max: number) => {
    if (max > 0) {
      TwitterConfig.maxTweets = max;
    }
  }
};

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
    
    // Get media URLs efficiently
    const mediaUrls = [
      ...(tweet.media_urls || []),
      ...(tweet.extended_entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || []),
      ...(tweet.entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || [])
    ].filter(Boolean);
    
    // Process media items at once
    const processedMedia = mediaUrls.map((url: string, i: number) => ({
      media_key: `media-${tweet.tweet_id}-${i}`,
      type: url.includes('.mp4') || url.includes('/video/') ? 'video' as const : 
            url.includes('.gif') ? 'animated_gif' as const : 'photo' as const,
      url: url,
      preview_image_url: tweet.extended_entities?.media?.[0]?.media_url_https || url,
    }));

    // Clean text efficiently
    const cleanedText = textContent
      .replace(/\s*https:\/\/t\.co\/\w+$/g, '')
      .replace(/(\s*[…\.]{3,})$/g, '')
      .replace(/\n{3,}/g, '\n\n');
    
    // Better thread and conversation detection
    const conversation_id = tweet.conversation_id || tweet.in_reply_to_status_id || tweet.tweet_id;
    const thread_id = tweet.thread_id || conversation_id;
    const in_reply_to_tweet_id = tweet.in_reply_to_tweet_id || tweet.in_reply_to_status_id;
    
    // Handle self-thread detection
    const isSelfThread = tweet.in_reply_to_user_id && 
                       tweet.user?.user_id && 
                       tweet.in_reply_to_user_id === tweet.user.user_id;
    
    // Only log important conversation information
    if (in_reply_to_tweet_id && (conversation_id !== tweet.tweet_id) && isSelfThread) {
      console.log(`Tweet ${tweet.tweet_id} is part of self-thread with conversation ID ${conversation_id}`);
    }
      
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
      conversation_id,
      in_reply_to_user_id: tweet.in_reply_to_user_id,
      in_reply_to_tweet_id,
      is_long: textContent.length > 280 || isLikelyTruncated,
      thread_id,
      is_self_thread: isSelfThread,
    };
};

// Fetch all replies for a tweet to build complete threads
const fetchAllReplies = async (tweetId: string, username: string): Promise<Tweet[]> => {
  const allReplies: Tweet[] = [];
  let continuationToken: string | null = null;
  let attempts = 0;
  const REPLY_MAX_ATTEMPTS = 3; // Renamed to avoid variable redeclaration
  const REPLY_MAX_PAGES = TwitterConfig.replyMaxPages; // Use configurable value
  const uniqueReplyIds = new Set<string>();
  let pageCount = 0;
  
  console.log(`Starting to fetch replies for tweet ${tweetId} by user ${username}`);

  do {
    try {
      // Only make the API call if we haven't exceeded page limits
      if (pageCount >= REPLY_MAX_PAGES) {
        console.log(`Reached maximum page limit (${REPLY_MAX_PAGES}) for tweet ${tweetId}, stopping`);
        break;
      }

      const url = continuationToken 
        ? `https://twitter154.p.rapidapi.com/tweet/replies/continuation?tweet_id=${tweetId}&continuation_token=${encodeURIComponent(continuationToken)}`
        : `https://twitter154.p.rapidapi.com/tweet/replies?tweet_id=${tweetId}`;

      console.log(`Fetching replies for tweet ${tweetId}, page ${pageCount + 1}`);
      const response = await makeApiRequest(url);
      
      if (response?.replies?.length) {
        // Process replies once and filter efficiently
        const filteredReplies = response.replies
          .map(processTweet)
          .filter((t: Tweet) => {
            // Only check for username match once and store result
            const isAuthor = t.author.username.toLowerCase() === username.toLowerCase();
            if (!isAuthor) return false;
            
            // Skip if already seen
            if (uniqueReplyIds.has(t.id)) return false;
            
            // Skip replies that mention other users (exclude tweets that start with @)
            const tweetText = t.full_text || t.text || '';
            if (tweetText.match(/^@[a-zA-Z0-9_]+/) && !tweetText.startsWith(`@${username}`)) {
              console.log(`Skipping reply ${t.id} because it mentions another user: "${tweetText.substring(0, 30)}..."`);
              return false;
            }
            
            // Include in results and mark as processed
            uniqueReplyIds.add(t.id);
            return true;
          });
        
        // Only add new unique replies
        if (filteredReplies.length > 0) {
          allReplies.push(...filteredReplies);
          console.log(`Found ${filteredReplies.length} new replies for tweet ${tweetId} (page ${pageCount + 1})`);
          
          // If we found replies on this page, always try to get the next page
          // This ensures we get complete threads
          if (response?.continuation_token) {
            continuationToken = response.continuation_token;
          }
        } else {
          console.log(`No new author replies found on page ${pageCount + 1} for tweet ${tweetId}`);
          
          // If we didn't find author replies on this page, only continue if there are
          // a significant number of total replies (might be paginated)
          if (response.replies.length >= 10 && response?.continuation_token) {
            continuationToken = response.continuation_token;
          } else {
            // Otherwise, no point continuing pagination
            continuationToken = null;
          }
        }
      } else {
        console.log(`No replies found for tweet ${tweetId} (page ${pageCount + 1})`);
        continuationToken = null;
      }

      // Track continuation token and increment counters
      pageCount++;
      
      // Reset attempt counter after successful response
      attempts = 0;
      
      // Delay between pages is still needed but can be shorter
      await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
      console.error(`Error fetching replies for tweet ${tweetId} (attempt ${attempts+1}):`, error);
      attempts++;
      
      // Add a longer delay on error
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Break immediately if we hit max attempts
      if (attempts >= REPLY_MAX_ATTEMPTS) {
        console.log(`Reached maximum attempts (${REPLY_MAX_ATTEMPTS}) for tweets ${tweetId}, moving on`);
        break;
      }
    }
  } while (continuationToken && attempts < REPLY_MAX_ATTEMPTS && pageCount < REPLY_MAX_PAGES);

  // Additional processing for self-threads
  if (allReplies.length > 1) {
    // Sort replies by creation time to ensure thread is in order
    allReplies.sort((a, b) => {
      try {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } catch (err) {
        // If date parsing fails, try to use ID as fallback (Twitter IDs are chronological)
        return Number(BigInt(a.id) - BigInt(b.id));
      }
    });
    
    // Set thread position for each tweet
    allReplies.forEach((tweet, index) => {
      tweet.thread_position = index;
      tweet.thread_index = index;
    });
  }

  console.log(`Total replies fetched for tweet ${tweetId}: ${allReplies.length} across ${pageCount} pages`);
  return allReplies;
};

// Main function to fetch user tweets with complete threads
export const fetchUserTweets = async (username: string, options?: { 
  initialFetch?: number, 
  maxTweets?: number 
}): Promise<Tweet[]> => {
  try {
    // Apply user-provided options if available
    const initialFetchLimit = options?.initialFetch || TwitterConfig.fetchLimit;
    const maxTweets = options?.maxTweets || TwitterConfig.maxTweets;
    
    const cacheKey = username.toLowerCase();
    if (API_CACHE.userTweets.has(cacheKey)) {
      console.log(`Using cached tweets for user ${username}`);
      return API_CACHE.userTweets.get(cacheKey) || [];
    }
    
    console.log(`Fetching ${initialFetchLimit} tweets for user ${username}`);
    
    // Get user ID first
    const userData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/details?username=${username}`);
    const userId = userData.user_id;
    if (!userId) throw new Error(`Could not find user ID for @${username}`);

    // Initial fetch - use user-specified limit
    const initialData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/tweets?username=${username}&limit=${initialFetchLimit}&user_id=${userId}&include_replies=false&include_pinned=false&includeFulltext=true`);
    
    // Process and filter tweets by author
    let allTweets = processTweets(initialData)
      .filter(tweet => {
        // Check if it's by the author
        const isAuthor = tweet.author.username.toLowerCase() === username.toLowerCase();
        if (!isAuthor) return false;
        
        // Skip tweets that mention other users (exclude tweets that start with @)
        const tweetText = tweet.full_text || tweet.text || '';
        if (tweetText.match(/^@[a-zA-Z0-9_]+/) && !tweetText.startsWith(`@${username}`)) {
          console.log(`Skipping tweet ${tweet.id} because it mentions another user: "${tweetText.substring(0, 30)}..."`);
          return false;
        }
        
        return true;
      });

    console.log(`Found ${allTweets.length} tweets in initial fetch for ${username}`);

    // Create a Set to track unique tweet IDs
    const uniqueTweetIds = new Set<string>();
    allTweets.forEach(tweet => uniqueTweetIds.add(tweet.id));

    // PRIORITY: Identify and fetch thread replies first
    // Choose threads with highest reply counts to save API calls
    const threadsToProcess = [...allTweets]
      .filter(tweet => tweet.reply_count && tweet.reply_count > 0) 
      .sort((a, b) => (b.reply_count || 0) - (a.reply_count || 0))
      .slice(0, TwitterConfig.threadsToProcess); // Use configurable value

    console.log(`Selected ${threadsToProcess.length} threads to fetch replies for`);
    
    // Process threads first to build complete conversations
    for (const tweet of threadsToProcess) {
      try {
        console.log(`Fetching replies for tweet ${tweet.id} (has ${tweet.reply_count} replies)`);
        const replies = await fetchAllReplies(tweet.id, username);
        
        // Filter out any replies we already have
        const newReplies = replies.filter(reply => {
          if (uniqueTweetIds.has(reply.id)) return false;
          uniqueTweetIds.add(reply.id);
          return true;
        });
        
        if (newReplies.length > 0) {
          console.log(`Added ${newReplies.length} new replies for tweet ${tweet.id}`);
          allTweets.push(...newReplies);
        }
        
        // Add delay between processing tweets
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error fetching replies for tweet ${tweet.id}:`, error);
        // Add longer delay after error
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    }

    console.log(`After fetching replies, total tweet count: ${allTweets.length}`);

    // Continue fetching more tweets using continuation token if we haven't reached maxTweets yet
    let continuationToken = initialData.continuation_token;
    let continuationCount = 0;
    
    while (continuationToken && allTweets.length < maxTweets && continuationCount < TwitterConfig.maxContinuations) {
      try {
        console.log(`Fetching continuation ${continuationCount + 1} for ${username}`);
        const continuationData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/tweets/continuation?username=${username}&continuation_token=${continuationToken}&user_id=${userId}`);
        
        const additionalTweets = processTweets(continuationData)
          .filter(tweet => {
            // Check if it's by the author and unique
            const isAuthor = tweet.author.username.toLowerCase() === username.toLowerCase();
            const isUnique = !uniqueTweetIds.has(tweet.id);
            
            if (!isAuthor || !isUnique) return false;
            
            // Skip tweets that mention other users (exclude tweets that start with @)
            const tweetText = tweet.full_text || tweet.text || '';
            if (tweetText.match(/^@[a-zA-Z0-9_]+/) && !tweetText.startsWith(`@${username}`)) {
              console.log(`Skipping tweet ${tweet.id} because it mentions another user: "${tweetText.substring(0, 30)}..."`);
              return false;
            }
            
            uniqueTweetIds.add(tweet.id);
            return true;
          });
        
        console.log(`Found ${additionalTweets.length} new tweets in continuation ${continuationCount + 1}`);
        
        if (additionalTweets.length > 0) {
          allTweets.push(...additionalTweets);
          
          // Check if any of these new tweets are part of threads and need replies
          const newThreadsToProcess = additionalTweets
            .filter(tweet => tweet.reply_count && tweet.reply_count > 2)
            .sort((a, b) => (b.reply_count || 0) - (a.reply_count || 0))
            .slice(0, 5); // Process up to 5 more threads
            
          if (newThreadsToProcess.length > 0) {
            console.log(`Found ${newThreadsToProcess.length} potential new threads in continuation, fetching replies`);
            
            for (const tweet of newThreadsToProcess) {
              try {
                console.log(`Fetching replies for new tweet ${tweet.id} (has ${tweet.reply_count} replies)`);
                const replies = await fetchAllReplies(tweet.id, username);
                
                // Filter out any replies we already have
                const newReplies = replies.filter(reply => {
                  if (uniqueTweetIds.has(reply.id)) return false;
                  uniqueTweetIds.add(reply.id);
                  return true;
                });
                
                if (newReplies.length > 0) {
                  console.log(`Added ${newReplies.length} new replies for tweet ${tweet.id}`);
                  allTweets.push(...newReplies);
                }
                
                // Add delay between processing tweets
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (error) {
                console.error(`Error fetching replies for new tweet ${tweet.id}:`, error);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }
        }
        
        // Update continuation token for next fetch
        continuationToken = continuationData.continuation_token;
        continuationCount++;
        
        // Add delay between continuations
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error(`Error fetching continuation ${continuationCount + 1}:`, error);
        break;
      }
    }

    console.log(`Fetched ${allTweets.length} total tweets (${uniqueTweetIds.size} unique)`);
    
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
  // Use maps to efficiently track tweets and threads
  const threadMap = new Map<string, Tweet[]>();
  const tweetMap = new Map<string, Tweet>();
  const processedIds = new Set<string>();
  
  // First pass: map tweets for quick access
  tweets.forEach(tweet => tweetMap.set(tweet.id, tweet));
  
  console.log(`Organizing ${tweets.length} tweets into threads`);
  
  // Pre-process to find explicit self-threads
  // These are tweets where is_self_thread is true, or where the user replies to themselves
  const selfThreads: Map<string, Set<string>> = new Map();
  
  tweets.forEach(tweet => {
    // If tweet is marked as self-thread already
    if (tweet.is_self_thread && tweet.conversation_id) {
      if (!selfThreads.has(tweet.conversation_id)) {
        selfThreads.set(tweet.conversation_id, new Set<string>());
      }
      selfThreads.get(tweet.conversation_id)!.add(tweet.id);
      
      // Add the reply-to tweet ID if it exists
      if (tweet.in_reply_to_tweet_id && tweetMap.has(tweet.in_reply_to_tweet_id)) {
        selfThreads.get(tweet.conversation_id)!.add(tweet.in_reply_to_tweet_id);
      }
    }
    // If tweet is a reply to another tweet by the same author
    else if (tweet.in_reply_to_tweet_id && tweet.in_reply_to_user_id) {
      const replyToTweet = tweetMap.get(tweet.in_reply_to_tweet_id);
      if (replyToTweet && replyToTweet.author.id === tweet.author.id) {
        const threadId = tweet.conversation_id || tweet.thread_id || tweet.in_reply_to_tweet_id;
        if (!selfThreads.has(threadId)) {
          selfThreads.set(threadId, new Set<string>());
        }
        selfThreads.get(threadId)!.add(tweet.id);
        selfThreads.get(threadId)!.add(tweet.in_reply_to_tweet_id);
      }
    }
  });
  
  // Process explicit self-threads first
  selfThreads.forEach((tweetIds, threadId) => {
    if (tweetIds.size > 1) {
      console.log(`Found self-thread with ID ${threadId} containing ${tweetIds.size} tweets`);
      
      // Get all tweets in this thread
      const threadTweets = Array.from(tweetIds)
        .map(id => tweetMap.get(id))
        .filter(t => t !== undefined) as Tweet[];
      
      // Sort tweets by thread_position if available, otherwise by creation time
      threadTweets.sort((a, b) => {
        if (a.thread_position !== undefined && b.thread_position !== undefined) {
          return a.thread_position - b.thread_position;
        }
        
        if (a.thread_index !== undefined && b.thread_index !== undefined) {
          return a.thread_index - b.thread_index;
        }
        
        // Try parsing dates
        try {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        } catch (err) {
          // Use tweet IDs as fallback
          return Number(BigInt(a.id) - BigInt(b.id));
        }
      });
      
      // Only create threads with more than one tweet
      if (threadTweets.length > 1) {
        // Set thread positions if not already set
        threadTweets.forEach((tweet, idx) => {
          tweet.thread_position = idx;
          tweet.thread_index = idx;
          processedIds.add(tweet.id);
        });
        
        threadMap.set(threadId, threadTweets);
      }
    }
  });
  
  // Process remaining tweets to find additional threads and conversations
  tweets.forEach(tweet => {
    if (processedIds.has(tweet.id)) return;
    
    const threadId = tweet.conversation_id || tweet.thread_id || tweet.id;
    
    // Find potential thread participants that weren't already in self-threads
    const threadMembers = tweets.filter(t => 
      !processedIds.has(t.id) && 
      ((t.conversation_id && t.conversation_id === threadId) || 
       (t.thread_id && t.thread_id === threadId) ||
       (t.in_reply_to_tweet_id && tweetMap.has(t.in_reply_to_tweet_id) && 
        t.author.id === tweet.author.id)) // Only group together tweets by the same author
    );
    
    if (threadMembers.length <= 1) {
      // This is a standalone tweet
      processedIds.add(tweet.id);
      if (!threadMap.has('standalone')) {
        threadMap.set('standalone', []);
      }
      threadMap.get('standalone')!.push(tweet);
      return;
    }
    
    // Try to establish thread order
    const thread: Tweet[] = [];
    const replyMap = new Map<string, Tweet[]>();
    
    // Build reply relationships
    threadMembers.forEach(t => {
      if (t.in_reply_to_tweet_id) {
        if (!replyMap.has(t.in_reply_to_tweet_id)) {
          replyMap.set(t.in_reply_to_tweet_id, []);
        }
        replyMap.get(t.in_reply_to_tweet_id)!.push(t);
      }
    });
    
    // Find potential root tweet - give preference to tweets that:
    // 1. Have no in_reply_to
    // 2. Are not a reply to another thread member
    // 3. Have the earliest creation date
    let rootTweet = threadMembers.find(t => 
      !t.in_reply_to_tweet_id || 
      !threadMembers.some(other => other.id === t.in_reply_to_tweet_id)
    );
    
    if (!rootTweet) {
      // No clear root found, use earliest tweet as root
      threadMembers.sort((a, b) => {
        try {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        } catch (err) {
          // Use tweet IDs as fallback
          return Number(BigInt(a.id) - BigInt(b.id));
        }
      });
      
      rootTweet = threadMembers[0];
    }
    
    if (rootTweet) {
      // Build thread from root
      thread.push(rootTweet);
      processedIds.add(rootTweet.id);
      
      // Build thread sequence 
      let currentId = rootTweet.id;
      
      // Recursively find all replies to build the thread
      const findReplies = (tweetId: string, depth: number = 0): Tweet[] => {
        if (depth > 10) return []; // Prevent infinite recursion
        if (!replyMap.has(tweetId)) return [];
        
        const result: Tweet[] = [];
        const replies = replyMap.get(tweetId)!.sort((a, b) => {
          try {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          } catch (err) {
            return Number(BigInt(a.id) - BigInt(b.id));
          }
        });
        
        for (const reply of replies) {
          if (!processedIds.has(reply.id)) {
            result.push(reply);
            processedIds.add(reply.id);
            // Find replies to this reply
            result.push(...findReplies(reply.id, depth + 1));
          }
        }
        
        return result;
      };
      
      // Add all replies in the correct order
      thread.push(...findReplies(rootTweet.id));
    } else {
      // No root found, sort by creation time
      const sorted = [...threadMembers].sort((a, b) => {
        try {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        } catch (err) {
          return Number(BigInt(a.id) - BigInt(b.id));
        }
      });
      
      thread.push(...sorted);
      sorted.forEach(t => processedIds.add(t.id));
    }
    
    // Only create a thread if we have multiple tweets
    if (thread.length > 1) {
      // Add thread position/index for each tweet
      thread.forEach((t, i) => {
        t.thread_position = i;
        t.thread_index = i;
      });
      
      threadMap.set(threadId, thread);
    } else if (thread.length === 1) {
      // Move to standalone
      if (!threadMap.has('standalone')) {
        threadMap.set('standalone', []);
      }
      threadMap.get('standalone')!.push(thread[0]);
    }
  });
  
  // Process any remaining unprocessed tweets as standalone
  tweets.forEach(tweet => {
    if (!processedIds.has(tweet.id)) {
      if (!threadMap.has('standalone')) {
        threadMap.set('standalone', []);
      }
      threadMap.get('standalone')!.push(tweet);
      processedIds.add(tweet.id);
    }
  });
  
  // Build final result array
  const result: (Tweet | Thread)[] = [];
  
  // Create thread objects
  threadMap.forEach((tweets, id) => {
    if (id === 'standalone') {
      // Add standalone tweets directly
      result.push(...tweets);
    } else if (tweets.length > 1) {
      // Create a thread
      result.push({
        id,
        tweets,
        author: tweets[0].author,
        created_at: tweets[0].created_at
      });
    }
  });
  
  console.log(`Organized tweets into ${result.filter(item => 'tweets' in item).length} threads and ${result.filter(item => !('tweets' in item)).length} standalone tweets`);
  
  // Sort by newest first
  return result.sort((a, b) => {
    const dateA = 'tweets' in a ? new Date(a.tweets[0].created_at).getTime() : new Date(a.created_at).getTime();
    const dateB = 'tweets' in b ? new Date(b.tweets[0].created_at).getTime() : new Date(b.created_at).getTime();
    return dateB - dateA;
  });
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
    console.log(`Fetching tweet continuation for tweet ${tweetId}`);
    const url = `https://twitter154.p.rapidapi.com/tweet/continuation?tweet_id=${tweetId}`;
    if (hasRecentlyFailed(url)) return null;

    const data = await makeApiRequest(url);
    if (!data) {
      console.log(`No continuation data found for tweet ${tweetId}`);
      return null;
    }

    // Process the tweet
    const processedTweet = processTweet(data);
    
    // Log the continuation tweet information
    console.log(`Found continuation tweet ${processedTweet.id} for tweet ${tweetId}`, {
      isReply: !!processedTweet.in_reply_to_tweet_id,
      inReplyToTweetId: processedTweet.in_reply_to_tweet_id,
      conversationId: processedTweet.conversation_id,
      threadId: processedTweet.thread_id
    });
    
    return processedTweet;
  } catch (error) {
    console.error('Error fetching tweet continuation:', error);
    return null;
  }
};

export const saveSelectedTweets = async (tweets: Tweet[], username: string = 'anonymous'): Promise<boolean> => {
  try {
    // Validate input
    if (!tweets || tweets.length === 0) {
      toast({
        title: 'No Tweets to Save',
        description: 'Please select tweets before saving.',
        variant: 'destructive',
      });
      return false;
    }

    console.log(`Saving ${tweets.length} tweets for user "${username}"`);
    
    // Sort tweets by creation date (newest first) before saving
    const sortedTweets = [...tweets].sort((a, b) => {
      try {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      } catch (err) {
        // If date parsing fails, use IDs as fallback (Twitter IDs are chronological)
        return Number(BigInt(b.id) - BigInt(a.id));
      }
    });
    
    // Preserve thread ordering for tweets in the same thread
    const threadMap = new Map<string, Tweet[]>();
    
    // Group by thread/conversation ID
    sortedTweets.forEach(tweet => {
      if (tweet.thread_id || tweet.conversation_id) {
        const threadId = tweet.thread_id || tweet.conversation_id;
        if (!threadMap.has(threadId)) {
          threadMap.set(threadId, []);
        }
        threadMap.get(threadId)!.push(tweet);
      }
    });
    
    // Sort tweets within each thread by thread_position or creation date
  threadMap.forEach((threadTweets, threadId) => {
      if (threadTweets.length > 1) {
    threadTweets.sort((a, b) => {
          // First by thread position if available
          if (a.thread_position !== undefined && b.thread_position !== undefined) {
            return a.thread_position - b.thread_position;
          }
          
          // Then by creation date
          try {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          } catch (err) {
            return Number(BigInt(a.id) - BigInt(b.id));
          }
        });
      }
    });
    
    // Build final ordered tweet list
    const orderedTweets: Tweet[] = [];
    
    // First add standalone tweets (newest first)
    sortedTweets.filter(tweet => !tweet.thread_id && !tweet.conversation_id)
      .forEach(tweet => orderedTweets.push(tweet));
    
    // Then add thread tweets (maintaining thread order)
    threadMap.forEach((threadTweets) => {
      orderedTweets.push(...threadTweets);
    });
    
    console.log(`Prepared ${orderedTweets.length} tweets for saving with correct ordering`);
    
    // Ensure all tweets have the necessary properties
    const processedTweets = orderedTweets.map(tweet => {
      // Make sure thread information is preserved
        return {
          ...tweet,
        savedAt: new Date().toISOString()
        };
    });
    
    // Make the API request
    const response = await fetch(`${BACKEND_API_URL}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        tweets: processedTweets, 
        username, 
        options: {
          preserveExisting: true,
          skipDuplicates: true,
          preserveThreadOrder: true
        }
      }),
    });

    // Check response status
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error: ${response.status} - ${errorText}`);
      throw new Error(`Error saving tweets: ${response.status} - ${errorText}`);
    }

    // Parse and handle response data
    const data = await response.json();
    
    // Show success toast
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
      description: 'Failed to save tweets. Please try again.',
      variant: 'destructive',
    });
    return false;
  }
};