import { TwitterResponse, Tweet, Thread } from './types';
import { toast } from '@/hooks/use-toast';

// API configuration
const RAPID_API_KEY = '4738e035f2mshf219c943077bffap1d4150jsn085da35f2f75';
const RAPID_API_HOST = 'twitter154.p.rapidapi.com';
const BACKEND_API_URL = 'http://localhost:5000/api/tweets';

/**
 * Fetches tweets for a given username
 */
export const fetchUserTweets = async (username: string): Promise<Tweet[]> => {
  try {
    // First get the user ID
    const userResponse = await fetch(`https://twitter154.p.rapidapi.com/user/details?username=${username}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST,
      },
    });

    if (!userResponse.ok) {
      throw new Error(`API error: ${userResponse.status}`);
    }

    const userData = await userResponse.json();
    const userId = userData.user_id;

    if (!userId) {
      throw new Error(`Could not find user ID for @${username}`);
    }

    // Then fetch tweets using the API endpoint with detailed parameters
    const response = await fetch(`https://twitter154.p.rapidapi.com/user/tweets?username=${username}&limit=50&includeReplies=false&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&sort_by=recency&include_video_info=true&includeMedia=true`, {
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
    
    // Fetch full tweet details for each tweet to ensure we have the complete content
    const processedTweets = processTweets(data);
    
    // For the first 5 tweets that are marked as long, fetch their full details
    const longTweets = processedTweets.filter(tweet => tweet.is_long).slice(0, 5);
    const detailsPromises = longTweets.map(tweet => fetchTweetDetails(tweet.id));
    const detailsResults = await Promise.all(detailsPromises);
    
    // Replace the long tweets with their detailed versions
    const tweetMap = new Map(processedTweets.map(tweet => [tweet.id, tweet]));
    detailsResults.forEach(detailedTweet => {
      if (detailedTweet) {
        tweetMap.set(detailedTweet.id, detailedTweet);
      }
    });
    
    return Array.from(tweetMap.values());
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
    const response = await fetch(`https://twitter154.p.rapidapi.com/lists/tweets/continuation?list_id=${listId}&limit=40&continuation_token=${continuationToken}`, {
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
export const fetchTweetDetails = async (tweetId: string): Promise<Tweet | null> => {
  try {
    const response = await fetch(`https://twitter154.p.rapidapi.com/tweet/details?tweet_id=${tweetId}&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&include_video_info=true&includeMedia=true`, {
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
    // Process and return a single tweet
    return processTweetDetails(data);
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
 * Processes raw Twitter API response into our Tweet format
 */
const processTweets = (response: any): Tweet[] => {
  if (!response.results || !Array.isArray(response.results)) {
    return [];
  }

  const tweets = response.results.map((tweet: any) => {
    // Ensure we get the full text content
    const textContent = tweet.extended_text || tweet.extended_tweet?.full_text || tweet.text || '';
    
    // Some non-Latin scripts like Gujarati can appear truncated even if character count is less than 280
    // We'll check for '...' at the end of text as an additional clue that it's truncated
    const isLikelyTruncated = textContent.endsWith('…') || 
      textContent.endsWith('...') || 
      textContent.includes('… https://') ||
      textContent.includes('... https://');
    
    // Handle media properly - combine all possible media sources
    const mediaUrls = [
      ...(tweet.media_urls || []),
      ...(tweet.extended_entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || []),
      ...(tweet.entities?.media?.map((m: any) => m.media_url_https || m.video_info?.variants?.[0]?.url) || [])
    ].filter(Boolean);
    
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
    
    // Check if there's an indicator that this is part of a thread with "show thread" text
    const hasShowThreadIndicator = Boolean(tweet.show_thread_indicator);
    
    return {
      id: tweet.tweet_id,
      text: tweet.text || '',
      full_text: textContent,
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
      conversation_id: tweet.conversation_id || tweet.tweet_id,
      in_reply_to_user_id: tweet.in_reply_to_user_id,
      is_long: textContent.length > 280 || Boolean(tweet.extended_text) || isLikelyTruncated || hasShowThreadIndicator,
    };
  });

  // Group tweets into threads
  return identifyThreads(tweets);
};

/**
 * Processes a single tweet's details
 */
const processTweetDetails = (response: any): Tweet | null => {
  if (!response) return null;
  
  // Ensure we get the full text content
  const textContent = response.extended_text || response.extended_tweet?.full_text || response.text || '';
  
  // Some non-Latin scripts like Gujarati can appear truncated even if character count is less than 280
  // We'll check for '...' at the end of text as an additional clue that it's truncated
  const isLikelyTruncated = textContent.endsWith('…') || 
    textContent.endsWith('...') || 
    textContent.includes('… https://') ||
    textContent.includes('... https://');
  
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
  
  // For tweet details, we should have the full text
  // But some APIs still don't provide it completely
  const hasCompleteContent = Boolean(response.extended_text);
  
  return {
    id: response.tweet_id,
    text: response.text || '',
    full_text: textContent,
    created_at: response.creation_date,
    public_metrics: {
      retweet_count: response.retweet_count || 0,
      reply_count: response.reply_count || 0,
      like_count: response.favorite_count || 0,
      quote_count: response.quote_count || 0,
    },
    author: {
      id: response.user.user_id,
      name: response.user.name,
      username: response.user.username,
      profile_image_url: response.user.profile_pic_url,
    },
    attachments: mediaUrls.length > 0 
      ? { media_keys: mediaUrls.map((_: any, i: number) => `media-${response.tweet_id}-${i}`) } 
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
        media_key: `media-${response.tweet_id}-${i}`,
        type: isVideo ? 'video' : isGif ? 'animated_gif' : 'photo',
        url,
        preview_image_url: response.extended_entities?.media?.[0]?.media_url_https || undefined,
      };
    }),
    referenced_tweets: response.quoted_tweet ? [{
      type: 'quoted',
      id: response.quoted_tweet.tweet_id,
      text: response.quoted_tweet.extended_text || response.quoted_tweet.text,
      author: {
        name: response.quoted_tweet.user?.name,
        username: response.quoted_tweet.user?.username,
        profile_image_url: response.quoted_tweet.user?.profile_pic_url
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
          media_key: `quoted-media-${response.quoted_tweet.tweet_id}-${i}`,
          type: isQuotedVideo ? 'video' : isQuotedGif ? 'animated_gif' : 'photo',
          url,
          preview_image_url: response.quoted_tweet?.extended_entities?.media?.[0]?.media_url_https || undefined,
        };
      })
    }] : undefined,
    conversation_id: response.conversation_id || response.tweet_id,
    in_reply_to_user_id: response.in_reply_to_user_id,
    is_long: false, // Set to false since we're returning the full tweet
  };
};

/**
 * Identifies tweets that belong to the same thread
 */
const identifyThreads = (tweets: Tweet[]): Tweet[] => {
  const conversationMap = new Map<string, Tweet[]>();
  
  // Group tweets by conversation_id
  tweets.forEach(tweet => {
    const key = tweet.conversation_id;
    if (!conversationMap.has(key)) {
      conversationMap.set(key, []);
    }
    conversationMap.get(key)?.push(tweet);
  });
  
  // Process each conversation
  const processedTweets: Tweet[] = [];
  
  conversationMap.forEach((convTweets, conversationId) => {
    // Sort tweets by creation date (oldest first)
    convTweets.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    
    // If there's only one tweet or tweets by different authors, they're not a thread
    if (
      convTweets.length <= 1 || 
      !convTweets.every(t => t.author.id === convTweets[0].author.id)
    ) {
      processedTweets.push(...convTweets);
      return;
    }
    
    // Mark all tweets in this thread
    const threadId = `thread-${conversationId}`;
    convTweets.forEach(tweet => {
      tweet.thread_id = threadId;
    });
    
    processedTweets.push(...convTweets);
  });
  
  return processedTweets;
};

/**
 * Groups tweets into threads
 */
export const groupThreads = (tweets: Tweet[]): (Tweet | Thread)[] => {
  const threadMap = new Map<string, Tweet[]>();
  const standaloneItems: (Tweet | Thread)[] = [];
  
  // First pass: identify all thread tweets
  tweets.forEach(tweet => {
    if (tweet.thread_id) {
      if (!threadMap.has(tweet.thread_id)) {
        threadMap.set(tweet.thread_id, []);
      }
      threadMap.get(tweet.thread_id)?.push(tweet);
    } else {
      standaloneItems.push(tweet);
    }
  });
  
  // Second pass: create Thread objects
  threadMap.forEach((threadTweets, threadId) => {
    if (threadTweets.length > 1) {
      // This is a valid thread with multiple tweets
      standaloneItems.push({
        id: threadId,
        tweets: threadTweets,
      });
    } else if (threadTweets.length === 1) {
      // This is a single tweet incorrectly marked as a thread
      standaloneItems.push(threadTweets[0]);
    }
  });
  
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
 */
export const saveSelectedTweets = async (tweets: Tweet[], username: string = 'anonymous'): Promise<boolean> => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tweets, username }),
    });

    if (!response.ok) {
      throw new Error(`Error saving tweets: ${response.status}`);
    }

    const data = await response.json();
    
    toast({
      title: 'Success',
      description: `${data.count} tweets saved to database.`,
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
