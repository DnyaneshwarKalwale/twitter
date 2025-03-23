import { TwitterResponse, Tweet, Thread } from './types';
import { toast } from '@/hooks/use-toast';

// API configuration
const RAPID_API_KEY = 'f43d7568c3msh311575b778bc840p1ee106jsn9683beef7e16';
const RAPID_API_HOST = 'twitter154.p.rapidapi.com';
const BACKEND_API_URL = 'https://twitter-aee7.onrender.com/api/tweets';

// Add a cache for API responses
const API_CACHE = {
  tweetDetails: new Map<string, Tweet>(),
  tweetContinuations: new Map<string, Tweet>(),
  userTweets: new Map<string, Tweet[]>(),
  failedRequests: new Map<string, {
    timestamp: number,
    errorCode: number,
    retryAfter?: number
  }>()
};

// Rate limiting variables
let lastApiCallTime = 0;
const MIN_API_CALL_INTERVAL = 2000; // Increased to 2 seconds between API calls
const MAX_RETRIES = 2; // Maximum number of retries for rate-limited requests
const RETRY_DELAY = 3000; // Initial retry delay in ms
const FAILED_REQUEST_EXPIRY = 10 * 60 * 1000; // 10 minutes before retrying failed requests

// API request queue to prevent too many concurrent requests
const requestQueue: (() => Promise<any>)[] = [];
let isProcessingQueue = false;

/**
 * Helper function to implement basic rate limiting
 */
const rateLimit = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  
  if (timeSinceLastCall < MIN_API_CALL_INTERVAL) {
    // Wait for the remaining time to meet the minimum interval
    const waitTime = MIN_API_CALL_INTERVAL - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastApiCallTime = Date.now();
};

/**
 * Process the API request queue one at a time
 */
const processQueue = async () => {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (request) {
      try {
        await request();
        // Apply rate limiting between requests
        await rateLimit();
      } catch (error) {
        console.error('Error processing queued request:', error);
      }
    }
  }
  
  isProcessingQueue = false;
};

/**
 * Add a request to the queue and start processing if not already
 */
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

/**
 * Helper function to check if a URL has failed recently
 */
const hasRecentlyFailed = (url: string): boolean => {
  const failedRequest = API_CACHE.failedRequests.get(url);
  if (!failedRequest) return false;
  
  const now = Date.now();
  // If the failed request is older than our expiry time, we can try again
  if (now - failedRequest.timestamp > FAILED_REQUEST_EXPIRY) {
    API_CACHE.failedRequests.delete(url);
    return false;
  }
  
  // If there's a specific retry-after time and we've passed it, we can try again
  if (failedRequest.retryAfter && now > failedRequest.retryAfter) {
    API_CACHE.failedRequests.delete(url);
    return false;
  }
  
  // Otherwise, this URL has recently failed and we should avoid it
  return true;
};

/**
 * Record a failed request to avoid immediate retries
 */
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

/**
 * Makes an XMLHttpRequest API call with proper headers and retry mechanism
 */
const makeApiRequest = (url: string, retryCount = 0): Promise<any> => {
  // Check if this URL has failed recently
  if (hasRecentlyFailed(url)) {
    return Promise.reject(new Error(`Skipping recently failed request to: ${url}`));
  }
  
  // Create a function that will execute the actual request
  const executeRequest = (): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Apply rate limiting first
        await rateLimit();
        
        const xhr = new XMLHttpRequest();
        xhr.withCredentials = true;
        
        xhr.addEventListener('readystatechange', function() {
          if (this.readyState === this.DONE) {
            if (this.status >= 200 && this.status < 300) {
              try {
                const data = JSON.parse(this.responseText);
                resolve(data);
              } catch (error) {
                reject(new Error(`Failed to parse response: ${error}`));
              }
            } else if (this.status === 429 && retryCount < MAX_RETRIES) {
              // Rate limited - retry with exponential backoff
              const delay = RETRY_DELAY * Math.pow(2, retryCount);
              console.warn(`Rate limited (429). Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
              
              setTimeout(() => {
                makeApiRequest(url, retryCount + 1)
                  .then(resolve)
                  .catch(reject);
              }, delay);
            } else if (this.status === 403) {
              // Record the failed request
              recordFailedRequest(url, this.status);
              reject(new Error(`API access forbidden (403). Your API key may have reached its daily limit or lacks required permissions.`));
            } else {
              // For other errors, record the failed request to avoid immediate retries
              if (this.status === 429) {
                // For rate limits, use a longer retry time
                recordFailedRequest(url, this.status, 60000); // 1 minute
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
      } catch (error) {
        reject(error);
      }
    });
  };
  
  // For retries, don't queue again
  if (retryCount > 0) {
    return executeRequest();
  }
  
  // Otherwise, queue the request
  return queueRequest(executeRequest);
};

/**
 * Helper function to detect if text is likely truncated
 * This handles various script types, particularly non-Latin scripts which
 * might appear truncated even with fewer characters
 */
const detectTruncatedText = (text: string): boolean => {
  if (!text || text.trim().length === 0) return false;
  
  // Obvious truncation indicators
  if (text.endsWith('…') || text.endsWith('...')) return true;
  if (text.includes('… https://') || text.includes('... https://')) return true;
  
  // Check for truncation in middle of sentences (common in threads)
  if (text.match(/[a-zA-Z]…\s*$/)) return true; // Word followed by ellipsis at end
  if (text.match(/[a-zA-Z]\.\.\.\s*$/)) return true; // Word followed by ... at end
  
  // Check for abrupt endings with prepositions or articles
  const lastWords = text.trim().split(/\s+/).slice(-2);
  const commonTruncationEnders = ['the', 'a', 'an', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'like', 'of', 'all'];
  if (lastWords.length > 0 && commonTruncationEnders.includes(lastWords[lastWords.length - 1].toLowerCase())) {
    return true;  // Ending with preposition or article suggests truncation
  }
  
  // Look for trailing URLs that might indicate truncation
  if (/\S+…\s*$/.test(text)) return true; // Word ending with ellipsis at the end
  
  // Check for non-Latin scripts (CJK, Arabic, Hindi, Hebrew, Thai, etc.)
  const hasNonLatinScript = /[\u0900-\u097F\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(text);
  
  // For non-Latin scripts, use a lower threshold as they can express more in fewer characters
  const thresholdLength = hasNonLatinScript ? 180 : 240;
  
  // If the text is close to Twitter's limit, it might be truncated
  if (text.length >= thresholdLength) {
    // For longer tweets, check if it ends with a proper sentence ending
    if (text.length > 200 && !/[.!?"]$/.test(text.trim())) {
      return true;
    }
  }
  
  // Look for suspicious sentence endings
  // If text doesn't end with a period, exclamation mark, question mark, or quotation mark
  // and is of significant length, it might be truncated
  if (text.length > 100 && !/[.!?"]$/.test(text.trim())) {
    // Check if the last "word" is less than 3 characters (might be cut off)
    const lastWord = text.trim().split(/\s+/).pop() || '';
    if (lastWord.length < 3 && !/[.!?"]/.test(lastWord)) {
      return true;
    }
  }
  
  return false;
};

/**
 * Fetches tweets for a given username
 */
export const fetchUserTweets = async (username: string): Promise<Tweet[]> => {
  try {
    // Check cache first
    const cacheKey = username.toLowerCase();
    if (API_CACHE.userTweets.has(cacheKey)) {
      console.log(`Using cached tweets for user @${username}`);
      return API_CACHE.userTweets.get(cacheKey) || [];
    }
    
    // First get the user ID
    const userData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/details?username=${username}`);
    
    const userId = userData.user_id;
    if (!userId) {
      throw new Error(`Could not find user ID for @${username}`);
    }

    // Initial fetch - usually returns ~20 tweets
    console.log(`Fetching initial tweets for @${username} (userId: ${userId})`);
    const initialData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/tweets?username=${username}&limit=40&includeReplies=false&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&sort_by=recency&include_video_info=true&includeMedia=true&user_id=${userId}`);
    
    // Use a Map to store tweets by ID to prevent duplicates
    const tweetMap = new Map();
    
    // Process initial tweets
    const initialTweets = processTweets(initialData);
    initialTweets.forEach(tweet => tweetMap.set(tweet.id, tweet));
    
    console.log(`Initial fetch returned ${initialTweets.length} tweets`);
    
    // Keep track of continuation tokens
    let continuationToken = initialData.continuation_token;
    let continuationAttempts = 0;
    const MAX_CONTINUATION_ATTEMPTS = 3; // Maximum number of continuation requests
    
    // Continue fetching more tweets until we reach at least 50 or run out of continuations
    while (continuationToken && tweetMap.size < 60 && continuationAttempts < MAX_CONTINUATION_ATTEMPTS) {
      console.log(`Fetching additional tweets (batch ${continuationAttempts + 1}) using continuation token: ${continuationToken}`);
      continuationAttempts++;
      
      try {
        // Add a small delay before each continuation request to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Fetch additional tweets using continuation token
        const continuationData = await makeApiRequest(`https://twitter154.p.rapidapi.com/user/tweets/continuation?username=${username}&limit=40&continuation_token=${continuationToken}&user_id=${userId}&include_replies=false&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&sort_by=recency&include_video_info=true&includeMedia=true`);
        
        // Process and add to our map
        const additionalTweets = processTweets(continuationData);
        console.log(`Continuation batch ${continuationAttempts} returned ${additionalTweets.length} more tweets`);
        
        additionalTweets.forEach(tweet => tweetMap.set(tweet.id, tweet));
        
        // Update the continuation token for the next iteration
        continuationToken = continuationData.continuation_token;
        
        // If no more continuation token or no new tweets were returned, break the loop
        if (!continuationToken || additionalTweets.length === 0) {
          console.log('No more continuation tokens or no new tweets, ending fetch loop');
          break;
        }
      } catch (error) {
        console.error(`Error fetching continuation batch ${continuationAttempts}:`, error);
        break; // Stop on error
      }
    }
    
    // Convert the map back to an array
    let allTweets = Array.from(tweetMap.values());
    console.log(`After all fetches, collected ${allTweets.length} unique tweets`);
    
    // For the first 3 tweets that are marked as long, fetch their full details
    const longTweets = allTweets.filter(tweet => tweet.is_long).slice(0, 3);
    const detailsPromises = longTweets.map(tweet => fetchTweetDetails(tweet.id));
    const detailsResults = await Promise.all(detailsPromises);
    
    // Replace the long tweets with their detailed versions
    detailsResults.forEach(detailedTweet => {
      if (detailedTweet) {
        tweetMap.set(detailedTweet.id, detailedTweet);
      }
    });
    
    // Convert to final array
    const finalTweets = Array.from(tweetMap.values());
    console.log(`Final tweet count after details fetch: ${finalTweets.length}`);
    
    // Cache the result
    API_CACHE.userTweets.set(cacheKey, finalTweets);
    
    return finalTweets;
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

/**
 * Fetches continuation tweets using a token
 */
export const fetchContinuationTweets = async (listId: string, continuationToken: string): Promise<Tweet[]> => {
  try {
    const data = await makeApiRequest(`https://twitter154.p.rapidapi.com/lists/tweets/continuation?list_id=${listId}&limit=40&continuation_token=${continuationToken}`);
    return processTweets(data);
  } catch (error) {
    console.error('Error fetching continuation tweets:', error);
    toast({
      title: 'Error',
      description: 'Failed to load more tweets. Please try again.',
      variant: 'destructive',
    });
    return [];
  }
};

/**
 * Fetches full tweet details for a single tweet
 */
export const fetchTweetDetails = async (tweetId: string, isSavedTweet = false): Promise<Tweet | null> => {
  if (!tweetId) {
    console.error('Invalid tweet ID provided to fetchTweetDetails');
    return null;
  }

  // Skip API calls for saved tweets - they should already have complete data
  if (isSavedTweet) {
    console.log(`Skipping API call for saved tweet ${tweetId}`);
    return null;
  }

  try {
    // Check cache first
    if (API_CACHE.tweetDetails.has(tweetId)) {
      console.log(`Using cached details for tweet ${tweetId}`);
      return API_CACHE.tweetDetails.get(tweetId) || null;
    }
    
    // Check if a continuation cache exists - might be sufficient
    if (API_CACHE.tweetContinuations.has(tweetId)) {
      console.log(`Using continuation cache for tweet ${tweetId} instead of details`);
      return API_CACHE.tweetContinuations.get(tweetId) || null;
    }
    
    console.log(`Fetching full details for tweet ${tweetId}`);
    
    const url = `https://twitter154.p.rapidapi.com/tweet/details?tweet_id=${tweetId}&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&include_video_info=true&includeMedia=true`;
    
    // Check if this URL has failed recently
    if (hasRecentlyFailed(url)) {
      console.warn(`Skipping recently failed details request for tweet ${tweetId}`);
      return null;
    }
    
    const data = await makeApiRequest(url);
    
    // Check if response is valid
    if (!data || data.error) {
      console.error(`Error in tweet details response for ${tweetId}:`, data?.error || 'No data returned');
      return null;
    }
    
    // Log the response to help debug any issues
    console.log(`Tweet details response for ${tweetId}:`, {
      hasExtendedText: !!data.extended_text,
      textLength: data.text?.length || 0,
      extendedTextLength: data.extended_text?.length || 0,
    });
    
    // Process and return a single tweet
    const processedTweet = processTweetDetails(data);
    
    // Cache the result if we got valid data
    if (processedTweet && processedTweet.full_text) {
      // Clean up the text before caching
      processedTweet.full_text = processedTweet.full_text.replace(/\s*https:\/\/t\.co\/\w+$/g, '');
      processedTweet.full_text = processedTweet.full_text.replace(/(\s*[…\.]{3,})$/g, '');
      
      API_CACHE.tweetDetails.set(tweetId, processedTweet);
    }
    
    return processedTweet;
  } catch (error) {
    console.error('Error fetching tweet details:', error);
    toast({
      title: 'Error',
      description: 'Failed to load tweet details. Please try again.',
      variant: 'destructive',
    });
    return null;
  }
};

/**
 * Fetches tweet continuation for tweets that are part of a thread
 * or for tweets that are truncated in the API response
 */
export const fetchTweetContinuation = async (tweetId: string, isSavedTweet = false): Promise<Tweet | null> => {
  if (!tweetId) {
    console.error('Invalid tweet ID provided to fetchTweetContinuation');
    return null;
  }

  // Skip API calls for saved tweets - they should already have complete data
  if (isSavedTweet) {
    console.log(`Skipping API call for saved tweet continuation ${tweetId}`);
    return null;
  }

  try {
    // Check cache first
    if (API_CACHE.tweetContinuations.has(tweetId)) {
      console.log(`Using cached continuation for tweet ${tweetId}`);
      return API_CACHE.tweetContinuations.get(tweetId) || null;
    }
    
    // If details cache exists, use that instead of making a new request
    if (API_CACHE.tweetDetails.has(tweetId)) {
      console.log(`Using details cache for tweet ${tweetId} instead of continuation`);
      return API_CACHE.tweetDetails.get(tweetId) || null;
    }
    
    console.log(`Fetching continuation for tweet ${tweetId}`);
    
    const url = `https://twitter154.p.rapidapi.com/user/tweets/continuation?tweet_id=${tweetId}&limit=1&includeReplies=false&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&sort_by=recency&include_video_info=true&includeMedia=true`;
    
    // Check if this URL has failed recently
    if (hasRecentlyFailed(url)) {
      console.warn(`Skipping recently failed continuation request for tweet ${tweetId}`);
      return null;
    }
    
    const data = await makeApiRequest(url);
    
    // Check if we have valid data
    if (!data || data.error) {
      console.error(`Error in tweet continuation response for ${tweetId}:`, data?.error || 'No data returned');
      return null;
    }
    
    console.log('Tweet continuation response:', {
      resultsCount: data.results ? data.results.length : 0,
      hasExtendedText: data.results?.[0]?.extended_text ? true : false,
    });
    
    // If we got results, process the first one
    if (data.results && data.results.length > 0) {
      // Use the same processing function we use for tweet details
      const processedTweet = processTweetDetails(data.results[0]);
      
      // Cache the result if we got valid data
      if (processedTweet && processedTweet.full_text) {
        // Clean up the text before caching
        processedTweet.full_text = processedTweet.full_text.replace(/\s*https:\/\/t\.co\/\w+$/g, '');
        processedTweet.full_text = processedTweet.full_text.replace(/(\s*[…\.]{3,})$/g, '');
        
        API_CACHE.tweetContinuations.set(tweetId, processedTweet);
      }
      
      return processedTweet;
    }
    
    // If no results from continuation endpoint, don't fallback to details anymore
    // as we now prefer to try details first in our component logic
    console.log(`No continuation results found for tweet ${tweetId}`);
    return null;
  } catch (error) {
    console.error('Error fetching tweet continuation:', error);
    toast({
      title: 'Error',
      description: 'Failed to load complete tweet content. Please try again.',
      variant: 'destructive',
    });
    return null;
  }
};

/**
 * Processes raw Twitter API response into our Tweet format
 */
const processTweets = (response: any): Tweet[] => {
  if (!response.results || !Array.isArray(response.results)) {
    console.log('No results found in response');
    return [];
  }

  console.log(`Processing ${response.results.length} raw tweets`);

  // Create a conversation map to better identify threads
  const conversationMap = new Map();
  
  // First, extract all relevant data from tweets for thread detection
  const tweetThreadData = response.results.map((tweet: any) => {
    const conversationId = tweet.conversation_id || tweet.tweet_id;
    const inReplyToId = tweet.in_reply_to_tweet_id;
    const inReplyToUserId = tweet.in_reply_to_user_id;
    const authorId = tweet.user?.user_id;
    
    return {
      tweet_id: tweet.tweet_id,
      conversation_id: conversationId,
      in_reply_to_tweet_id: inReplyToId,
      in_reply_to_user_id: inReplyToUserId,
      author_id: authorId,
      created_at: tweet.creation_date
    };
  });
  
  // Create a map of conversations and replies
  tweetThreadData.forEach(data => {
    const conversationId = data.conversation_id;
    if (!conversationMap.has(conversationId)) {
      conversationMap.set(conversationId, []);
    }
    conversationMap.get(conversationId).push(data.tweet_id);
  });
  
  // Create a map of replies
  const replyMap = new Map();
  tweetThreadData.forEach(data => {
    if (data.in_reply_to_tweet_id) {
      if (!replyMap.has(data.in_reply_to_tweet_id)) {
        replyMap.set(data.in_reply_to_tweet_id, []);
      }
      replyMap.get(data.in_reply_to_tweet_id).push(data.tweet_id);
    }
  });

  // Log conversation statistics
  let multiTweetConversations = 0;
  conversationMap.forEach((tweets, conversationId) => {
    if (tweets.length > 1) {
      multiTweetConversations++;
    }
  });
  console.log(`Found ${conversationMap.size} conversations, ${multiTweetConversations} with multiple tweets`);

  // Now process each tweet with thread identification
  const tweets = response.results.map((tweet: any) => {
    // Ensure we get the full text content
    const textContent = tweet.extended_text || tweet.extended_tweet?.full_text || tweet.full_text || tweet.text || '';
    
    // Some non-Latin scripts like Gujarati can appear truncated even if character count is less than 280
    // We'll check for '...' at the end of text as an additional clue that it's truncated
    const isLikelyTruncated = detectTruncatedText(textContent);
    
    // Handle media properly - combine all possible media sources
    const mediaUrls = [
      ...(tweet.media_urls || []),
      ...(tweet.extended_entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || []),
      ...(tweet.entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || [])
    ].filter(Boolean);
    
    // Get conversation information to identify threads
    const conversationId = tweet.conversation_id || tweet.tweet_id;
    const inReplyToTweetId = tweet.in_reply_to_tweet_id;
    const inReplyToUserId = tweet.in_reply_to_user_id;
    const currentAuthorId = tweet.user?.user_id;
    
    // Determine if the tweet is part of a thread
    let isPartOfThread = false;
    
    // Check if this tweet has replies from the same author
    if (replyMap.has(tweet.tweet_id)) {
      const replies = replyMap.get(tweet.tweet_id);
      // Look for any replies from the same author
      const sameAuthorReplies = tweetThreadData.filter(data => 
        replies.includes(data.tweet_id) && data.author_id === currentAuthorId
      );
      if (sameAuthorReplies.length > 0) {
        isPartOfThread = true;
      }
    }
    
    // Check if this tweet is a reply to a tweet from the same author
    if (inReplyToTweetId && inReplyToUserId === currentAuthorId) {
      isPartOfThread = true;
    }
    
    // Check if the conversation has multiple tweets from the same author
    if (conversationMap.has(conversationId)) {
      const conversationTweets = conversationMap.get(conversationId);
      if (conversationTweets.length > 1) {
        // Count tweets from the same author in this conversation
        const sameAuthorTweets = tweetThreadData.filter(data => 
          conversationTweets.includes(data.tweet_id) && data.author_id === currentAuthorId
        );
        if (sameAuthorTweets.length > 1) {
          isPartOfThread = true;
        }
      }
    }
    
    // If the tweet has a "show thread" indicator
    const hasShowThreadIndicator = Boolean(tweet.show_thread_indicator);
    if (hasShowThreadIndicator) {
      isPartOfThread = true;
    }
    
    // Specifically extract video content
    const videoInfo = tweet.extended_entities?.media?.find((m: any) => 
      m.type === 'video' || m.type === 'animated_gif' || m.video_info
    )?.video_info;
    
    // Get the highest quality video variant
    const videoVariants = videoInfo?.variants || [];
    const highestQualityVideo = videoVariants
      .filter((v: any) => v.content_type === 'video/mp4')
      .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    
    // If we have video, add it to the media array
    if (highestQualityVideo) {
      mediaUrls.push(highestQualityVideo.url);
    }
    
    // Process quoted tweet media similarly
    const quotedTweetMediaUrls = 
      tweet.quoted_tweet?.media_urls || 
      tweet.quoted_tweet?.extended_entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || 
      tweet.quoted_tweet?.entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || 
      [];
    
    // Check for videos in quoted tweet
    const quotedVideoInfo = tweet.quoted_tweet?.extended_entities?.media?.find((m: any) => 
      m.type === 'video' || m.type === 'animated_gif' || m.video_info
    )?.video_info;
    
    // Get the highest quality video variant for quoted tweet
    const quotedVideoVariants = quotedVideoInfo?.variants || [];
    const quotedHighestQualityVideo = quotedVideoVariants
      .filter((v: any) => v.content_type === 'video/mp4')
      .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    
    // If quoted tweet has video, add it
    if (quotedHighestQualityVideo) {
      quotedTweetMediaUrls.push(quotedHighestQualityVideo.url);
    }
    
    // Clean up the text content
    let cleanedText = textContent;
    if (cleanedText) {
      // Remove trailing t.co links that Twitter adds (they're just reference links)
      cleanedText = cleanedText.replace(/\s*https:\/\/t\.co\/\w+$/g, '');
      
      // Also remove any trailing ellipsis markers that might be from API truncation
      cleanedText = cleanedText.replace(/(\s*[…\.]{3,})$/g, '');
      
      // Remove extra newlines that might be added
      cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');
    }
    
    return {
      id: tweet.tweet_id,
      text: tweet.text || '',
      full_text: cleanedText,
      created_at: tweet.creation_date,
      public_metrics: {
        retweet_count: tweet.retweet_count || 0,
        reply_count: tweet.reply_count || 0,
        like_count: tweet.favorite_count || 0,
        quote_count: tweet.quote_count || 0,
      },
      author: {
        id: tweet.user.user_id,
        name: tweet.user.name,
        username: tweet.user.username,
        profile_image_url: tweet.user.profile_pic_url,
      },
      attachments: mediaUrls.length > 0 
        ? { media_keys: mediaUrls.map((_: any, i: number) => `media-${tweet.tweet_id}-${i}`) } 
        : undefined,
      media: mediaUrls.map((url: string, i: number) => {
        // Determine the media type
        const isVideo = 
          url.includes('.mp4') || 
          url.includes('/video/') || 
          (videoInfo && i === mediaUrls.length - 1 && highestQualityVideo);
        
        const isGif = 
          url.includes('.gif') || 
          (videoInfo?.type === 'animated_gif');
        
        return {
          media_key: `media-${tweet.tweet_id}-${i}`,
          type: isVideo ? 'video' : isGif ? 'animated_gif' : 'photo',
          url,
          preview_image_url: tweet.extended_entities?.media?.[0]?.media_url_https || undefined,
        };
      }),
      referenced_tweets: tweet.quoted_tweet ? [{
        type: 'quoted',
        id: tweet.quoted_tweet.tweet_id,
        text: tweet.quoted_tweet.extended_text || tweet.quoted_tweet.text,
        author: {
          name: tweet.quoted_tweet.user?.name,
          username: tweet.quoted_tweet.user?.username,
          profile_image_url: tweet.quoted_tweet.user?.profile_pic_url
        },
        media: quotedTweetMediaUrls.map((url: string, i: number) => {
          // Determine quoted media type
          const isQuotedVideo = 
            url.includes('.mp4') || 
            url.includes('/video/') || 
            (quotedVideoInfo && i === quotedTweetMediaUrls.length - 1 && quotedHighestQualityVideo);
          
          const isQuotedGif = 
            url.includes('.gif') || 
            (quotedVideoInfo?.type === 'animated_gif');
          
          return {
            media_key: `quoted-media-${tweet.quoted_tweet.tweet_id}-${i}`,
            type: isQuotedVideo ? 'video' : isQuotedGif ? 'animated_gif' : 'photo',
            url,
            preview_image_url: tweet.quoted_tweet?.extended_entities?.media?.[0]?.media_url_https || undefined,
          };
        })
      }] : undefined,
      conversation_id: conversationId,
      in_reply_to_user_id: tweet.in_reply_to_user_id,
      in_reply_to_tweet_id: tweet.in_reply_to_tweet_id,
      is_long: textContent.length > 280 || Boolean(tweet.extended_text) || isLikelyTruncated || hasShowThreadIndicator,
      thread_id: isPartOfThread ? conversationId : undefined,
    };
  });

  // Log how many tweets have thread_id set
  const tweetsWithThreadId = tweets.filter(tweet => tweet.thread_id !== undefined).length;
  console.log(`After processing, ${tweetsWithThreadId} tweets have thread_id set`);

  return tweets;
};

/**
 * Processes a single tweet's details
 */
const processTweetDetails = (response: any): Tweet | null => {
  if (!response) {
    console.log('Null response provided to processTweetDetails');
    return null;
  }
  
  try {
    // Ensure we get the full text content - try all possible sources
    let textContent = '';
    
    // Log all possible text sources for debugging
    console.log('Text sources for tweet', response.tweet_id, {
      text_length: response.text?.length || 0,
      extended_text_length: response.extended_text?.length || 0,
      full_text_length: response.full_text?.length || 0,
      extended_tweet_full_text_length: response.extended_tweet?.full_text?.length || 0,
      legacy_extended_tweet_length: response.legacy?.extended_tweet?.full_text?.length || 0,
      entities_text_length: response.entities?.text?.length || 0,
      display_text_range: response.display_text_range || 'none'
    });
    
    // Check for extended text from multiple sources in order of completeness
    if (response.extended_text && response.extended_text.trim().length > 0) {
      textContent = response.extended_text;
    } else if (response.full_text && response.full_text.trim().length > 0) {
      textContent = response.full_text;
    } else if (response.extended_tweet?.full_text && response.extended_tweet.full_text.trim().length > 0) {
      textContent = response.extended_tweet.full_text;
    } else if (response.legacy?.extended_tweet?.full_text && response.legacy.extended_tweet.full_text.trim().length > 0) {
      textContent = response.legacy.extended_tweet.full_text;
    } else if (response.text && response.text.trim().length > 0) {
      textContent = response.text;
    } else {
      textContent = '';
    }
    
    // If we got a truncated response, check if the display text might be complete
    // Sometimes the API marks tweets as truncated but actually provides the full content
    if (response.display_text_range && response.text) {
      const endIndex = response.display_text_range[1];
      if (endIndex > 0 && endIndex <= response.text.length && endIndex > textContent.length) {
        textContent = response.text.substring(0, endIndex);
      }
    }
    
    // Clean up the text content
    if (textContent) {
      // Remove trailing t.co links that Twitter adds (they're just reference links)
      // But only if they appear at the end of the text and are isolated
      textContent = textContent.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, '');
      
      // Also remove any trailing ellipsis markers that might be from API truncation
      textContent = textContent.replace(/(\s*[…\.]{3,})$/g, '');
      
      // Remove extra newlines that might be added
      textContent = textContent.replace(/\n{3,}/g, '\n\n');
    }

    // Sometimes Twitter will include a media URL at the end of text. Check if that's true
    // and if so, don't consider it as truncated.
    let hasTrailingMediaUrl = false;
    const mediaRegex = /\bhttps:\/\/t\.co\/\w+\s*$/;
    if (mediaRegex.test(textContent) && (response.media_urls?.length > 0 || response.entities?.media?.length > 0)) {
      hasTrailingMediaUrl = true;
    }
    
    // Check if any of the attachments or media in the API response correspond to text ending
    // If the original text ended with a URL which corresponds to an image, we'll consider it complete
    if (response.entities?.urls) {
      const lastUrl = response.entities.urls[response.entities.urls.length - 1];
      if (lastUrl && textContent.endsWith(lastUrl.url || lastUrl.display_url)) {
        hasTrailingMediaUrl = true;
      }
    }
    
    // Check if the text is truncated
    // Consider text truncated if it ends with ellipsis, or if text is longer than typical tweet limit (280)
    // and doesn't have a proper ending, or if extended_text is present
    const isLikelyTruncated = !hasTrailingMediaUrl && detectTruncatedText(textContent);
  
  // Handle media properly - combine all possible media sources
  const mediaUrls = [
    ...(response.media_urls || []),
    ...(response.extended_entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || []),
    ...(response.entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || [])
  ].filter(Boolean);
  
  // Specifically extract video content
  const videoInfo = response.extended_entities?.media?.find((m: any) => 
    m.type === 'video' || m.type === 'animated_gif' || m.video_info
  )?.video_info;
  
  // Get the highest quality video variant
  const videoVariants = videoInfo?.variants || [];
  const highestQualityVideo = videoVariants
    .filter((v: any) => v.content_type === 'video/mp4')
    .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  
  // If we have video, add it to the media array
  if (highestQualityVideo) {
    mediaUrls.push(highestQualityVideo.url);
  }
  
  // Process quoted tweet media similarly
  const quotedTweetMediaUrls = 
    response.quoted_tweet?.media_urls || 
    response.quoted_tweet?.extended_entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || 
    response.quoted_tweet?.entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || 
    [];
  
  // Check for videos in quoted tweet
  const quotedVideoInfo = response.quoted_tweet?.extended_entities?.media?.find((m: any) => 
    m.type === 'video' || m.type === 'animated_gif' || m.video_info
  )?.video_info;
  
  // Get the highest quality video variant for quoted tweet
  const quotedVideoVariants = quotedVideoInfo?.variants || [];
  const quotedHighestQualityVideo = quotedVideoVariants
    .filter((v: any) => v.content_type === 'video/mp4')
    .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  
  // If quoted tweet has video, add it
  if (quotedHighestQualityVideo) {
    quotedTweetMediaUrls.push(quotedHighestQualityVideo.url);
  }
  
    // For tweet details, check if we have valid full content
    const hasCompleteContent = Boolean(
      (response.extended_text && response.extended_text.length > (response.text?.length || 0)) ||
      (response.extended_tweet?.full_text && response.extended_tweet.full_text.length > (response.text?.length || 0))
    );
    
    // Check if text contains important short URLs (bit.ly, tinyurl, etc.)
    const hasShortUrl = /https?:\/\/(?:bit\.ly|tinyurl|goo\.gl|t\.co)\/\w+/.test(textContent);
    
    // Clean up the text, preserving important URLs
    if (!hasShortUrl) {
      // Only remove t.co URLs if they're not important short links
      textContent = textContent.replace(/\s*https:\/\/t\.co\/\w{10,}\s*$/g, '');
      textContent = textContent.replace(/(\s*[…\.]{3,})$/g, '');
    } else {
      console.log(`Preserving short URLs in tweet ${response.tweet_id}: ${textContent}`);
      // Only remove known Twitter tracking URLs with long random strings
      textContent = textContent.replace(/\s*https:\/\/t\.co\/[a-zA-Z0-9]{10,}\s*$/g, '');
    }
    
    // Remove excessive newlines but keep paragraph structure
    textContent = textContent.replace(/\n{3,}/g, '\n\n');
    
    // Calculate if tweet should be marked as long
    const isLongTweet = 
      textContent.length > 280 || 
      Boolean(response.extended_text) || 
      isLikelyTruncated || 
      Boolean(response.show_thread_indicator);
  
  // Handle quoted tweets
  let quotedTweet = null;
  if (response.quoted_status) {
    quotedTweet = {
      id: response.quoted_status.tweet_id,
      text: response.quoted_status.text || '',
      author: {
        id: response.quoted_status.user?.user_id,
        name: response.quoted_status.user?.name,
        username: response.quoted_status.user?.username,
        profile_image_url: response.quoted_status.user?.profile_pic_url,
      },
      created_at: response.quoted_status.creation_date,
    };
  }
  
  return {
    id: response.tweet_id,
    text: response.text || '',
    full_text: textContent,
    created_at: response.creation_date,
    retweet_count: response.retweet_count || 0,
    reply_count: response.reply_count || 0,
    favorite_count: response.favorite_count || 0,
    quote_count: response.quote_count || 0,
    author: {
        id: response.user?.user_id,
        name: response.user?.name,
        username: response.user?.username,
        profile_image_url: response.user?.profile_pic_url,
    },
    media: mediaUrls.map((url: string, i: number) => {
      // Determine the media type
      const isVideo = 
        url.includes('.mp4') || 
        url.includes('/video/') || 
        url.includes('video_thumb');
      
      const isGif = url.includes('.gif') || videoVariants.some(v => v.content_type === 'image/gif');
      
      return {
        media_key: `media-${response.tweet_id}-${i}`,
        type: isVideo ? 'video' : (isGif ? 'animated_gif' : 'photo'),
        url: url,
        preview_image_url: videoInfo?.thumbnail_url || url,
      };
    }),
    quoted_tweet: quotedTweet,
    conversation_id: response.conversation_id,
    in_reply_to_status_id: response.in_reply_to_status_id,
    in_reply_to_user_id: response.in_reply_to_user_id,
    in_reply_to_tweet_id: response.in_reply_to_status_id, // Map to the same field
    is_long: isLongTweet,
    thread_id: response.conversation_id // Use conversation_id as thread_id
  };
  } catch (error) {
    console.error('Error processing tweet details:', error);
    return null;
  }
};

/**
 * Groups tweets into threads and individual tweets
 */
export const groupThreads = (tweets: Tweet[]): (Tweet | Thread)[] => {
  // Log initial count
  console.log(`Starting groupThreads with ${tweets.length} tweets`);
  
  const threadMap = new Map<string, Tweet[]>();
  const standaloneItems: (Tweet | Thread)[] = [];
  
  // Count how many tweets have a thread_id
  let threadsCount = 0;
  tweets.forEach(tweet => {
    if (tweet.thread_id) {
      threadsCount++;
    }
  });
  console.log(`Found ${threadsCount} tweets with thread_id`);
  
  // First, create a mapping of tweets by ID for easy lookup
  const tweetMap = new Map<string, Tweet>();
  tweets.forEach(tweet => {
    tweetMap.set(tweet.id, tweet);
  });
  
  // Next, identify the root tweets of each thread
  // A root tweet is one that has no in_reply_to_tweet_id or its in_reply_to_tweet_id is not in our dataset
  const rootTweets = new Set<string>();
  const nonRootTweets = new Set<string>();
  
  // First pass: identify all thread tweets and roots
  tweets.forEach(tweet => {
    if (tweet.thread_id) {
      // Check if this is a reply to another tweet in our dataset
      if (tweet.in_reply_to_tweet_id && tweetMap.has(tweet.in_reply_to_tweet_id)) {
        nonRootTweets.add(tweet.id);
        
        // Make sure the thread_id exists in our threadMap
      if (!threadMap.has(tweet.thread_id)) {
        threadMap.set(tweet.thread_id, []);
      }
      threadMap.get(tweet.thread_id)?.push(tweet);
    } else {
        // This might be a root tweet
        rootTweets.add(tweet.id);
        
        // Add to threadMap
        if (!threadMap.has(tweet.thread_id)) {
          threadMap.set(tweet.thread_id, []);
        }
        threadMap.get(tweet.thread_id)?.push(tweet);
      }
    } else {
      // This is a standalone tweet
      standaloneItems.push(tweet);
    }
  });
  
  // Log information about root tweets
  console.log(`Found ${rootTweets.size} potential root tweets and ${nonRootTweets.size} non-root tweets in threads`);
  
  // Remove any tweets from rootTweets that are actually replies to other tweets in our root set
  tweets.forEach(tweet => {
    if (tweet.in_reply_to_tweet_id && rootTweets.has(tweet.in_reply_to_tweet_id)) {
      rootTweets.delete(tweet.id);
    }
  });
  
  console.log(`After filtering, there are ${rootTweets.size} actual root tweets`);
  
  // For each thread, order the tweets chronologically
  threadMap.forEach((threadTweets, threadId) => {
    // Sort by date (oldest first, which is normal for threads)
    threadTweets.sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  });
  
  // Second pass: create Thread objects for each thread
  let threadCount = 0;
  threadMap.forEach((threadTweets, threadId) => {
    if (threadTweets.length > 1) {
      // This is a valid thread with multiple tweets
      standaloneItems.push({
        id: threadId,
        tweets: threadTweets,
      });
      threadCount++;
    } else if (threadTweets.length === 1) {
      // This is a single tweet marked as a thread - check if it's marked as "long"
      // If it's marked as long, keep it standalone, otherwise it might still be a single-tweet thread
      const tweet = threadTweets[0];
      if (tweet.is_long) {
        // It's a "long" tweet, keeping it standalone
        standaloneItems.push(tweet);
      } else {
        // Even though it's a single tweet, treat it as a potential thread
        standaloneItems.push({
          id: threadId,
          tweets: threadTweets,
        });
        threadCount++;
      }
    }
  });

  console.log(`Grouped ${tweets.length} tweets into ${threadCount} threads and ${standaloneItems.length - threadCount} standalone tweets`);
  
  // Count total tweets in standaloneItems
  let totalTweetsInStandaloneItems = 0;
  standaloneItems.forEach(item => {
    if ('tweets' in item) {
      totalTweetsInStandaloneItems += item.tweets.length;
    } else {
      totalTweetsInStandaloneItems += 1;
    }
  });
  
  console.log(`Total tweets in result: ${totalTweetsInStandaloneItems} (should match original count: ${tweets.length})`);
  
  // Sort by newest first
  return standaloneItems.sort((a, b) => {
    const dateA = 'tweets' in a 
      ? new Date(a.tweets[0].created_at).getTime() 
      : new Date(a.created_at).getTime();
    const dateB = 'tweets' in b 
      ? new Date(b.tweets[0].created_at).getTime() 
      : new Date(b.created_at).getTime();
    return dateB - dateA;
  });
};

/**
 * Fetches media tweets for a given user ID
 */
export const fetchUserMedia = async (userId: string): Promise<Tweet[]> => {
  try {
    const response = await fetch(`https://twitter154.p.rapidapi.com/user/medias?user_id=${userId}&limit=10&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&include_video_info=true&includeMedia=true`, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return processTweets(data);
  } catch (error) {
    console.error('Error fetching user media:', error);
    toast({
      title: 'Error',
      description: 'Failed to fetch user media. Please try again.',
      variant: 'destructive',
    });
    return [];
  }
};

/**
 * Saves selected tweets to the database
 * Preserves existing tweets and skips duplicates
 */
export const saveSelectedTweets = async (tweets: Tweet[], username: string = 'anonymous'): Promise<boolean> => {
  try {
    // Sort tweets within the same thread by creation date before saving
    const processedTweets = [...tweets].map(tweet => {
      // Add thread position property to help with ordering
      if (tweet.thread_id) {
        return {
          ...tweet,
          thread_position: new Date(tweet.created_at).getTime(),
          thread_index: tweet.thread_index || 0
        };
      }
      return tweet;
    });
    
    // Log the sorted tweets for debugging
    console.log(`Saving ${processedTweets.length} tweets with thread ordering`);
    
    // Add option to preserve existing tweets and skip duplicates
    const response = await fetch(`${BACKEND_API_URL}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        tweets: processedTweets, 
        username, 
        options: {
          preserveExisting: true,  // Don't replace existing tweets
          skipDuplicates: true,    // Skip duplicate tweets
          preserveThreadOrder: true // Maintain thread ordering
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Error saving tweets: ${response.status}`);
    }

    const data = await response.json();
    
    // Show a more detailed success message including how many duplicates were skipped
    toast({
      title: 'Tweets Saved',
      description: data.skippedCount 
        ? `${data.count} tweets saved. ${data.skippedCount} duplicates skipped.` 
        : `${data.count} tweets saved to database.`,
    });
    
    // Check if tweets are immediately available from the backend
    setTimeout(() => {
      fetchSavedTweetsDebug(username);
    }, 1000);
    
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

/**
 * Debugging utility to check if saved tweets can be retrieved
 */
export const fetchSavedTweetsDebug = async (username: string = 'anonymous'): Promise<void> => {
  try {
    const endpoint = username 
      ? `${BACKEND_API_URL}/saved/user/${username}` 
      : `${BACKEND_API_URL}/saved`;
    
    console.log(`Checking saved tweets at endpoint: ${endpoint}`);
    
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      console.error(`Failed to fetch saved tweets for debugging: ${response.status}`);
      return;
    }
    
    const data = await response.json();
    
    console.log('DEBUG - Saved tweets from backend:', {
      success: data.success,
      count: data.count,
      individualTweetCount: data.data.filter((item: any) => !item.tweets).length,
      threadCount: data.data.filter((item: any) => item.tweets).length,
      firstFewItems: data.data.slice(0, 3)
    });
  } catch (error) {
    console.error('Error in fetchSavedTweetsDebug:', error);
  }
};
