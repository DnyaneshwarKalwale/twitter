import React, { useState, useEffect } from 'react';
import { Tweet, Thread } from '@/utils/types';
import { Checkbox } from '@/components/ui/checkbox';
import MediaDisplay from './MediaDisplay';
import { MessageSquare, Heart, RefreshCw, Share, ChevronDown, ChevronUp, CheckSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { fetchTweetDetails, fetchTweetContinuation } from '@/utils/api';

interface TweetThreadProps {
  thread: Thread;
  selectedTweets: Set<string>;
  onSelectToggle: (tweet: Tweet) => void;
  onSelectThread: (thread: Thread, select: boolean) => void;
}

const TweetThread: React.FC<TweetThreadProps> = ({ 
  thread, 
  selectedTweets = new Set(), 
  onSelectToggle = () => {}, 
  onSelectThread = () => {}
}) => {
  const [expanded, setExpanded] = useState(true);
  const [visibleTweets, setVisibleTweets] = useState<Tweet[]>(thread.tweets);
  const [expandedTweets, setExpandedTweets] = useState<Set<string>>(new Set());
  const [loadingTweets, setLoadingTweets] = useState<Set<string>>(new Set());
  const [fullTweets, setFullTweets] = useState<Map<string, Tweet>>(new Map());
  
  // Ensure thread has tweets array
  if (!thread || !thread.tweets || thread.tweets.length === 0) {
    console.error("Thread is empty or missing tweets array");
    return null;
  }
  
  // Log thread info for debugging
  console.log(`Thread ${thread.id} has ${thread.tweets.length} tweets`);
  
  // Preload full content for long tweets when component mounts
  useEffect(() => {
    // Skip preloading for saved tweets
    if (thread.tweets.some(tweet => tweet.savedAt)) {
      return; // Exit early if any tweet in thread is saved
    }
    
    // Debug threadID and content
    console.log(`Thread ${thread.id} has ${thread.tweets.length} tweets, preloading content`);
    thread.tweets.forEach(tweet => {
      console.log(`Tweet ${tweet.id} text length: ${tweet.text.length}, full_text length: ${tweet.full_text?.length || 0}`);
    });
    
    const preloadLongTweets = async () => {
      // Find the first 2 long tweets that aren't already loaded
      const longTweets = thread.tweets
        .filter(tweet => (tweet.is_long || isTruncated(tweet)) && !fullTweets.has(tweet.id))
        .slice(0, 3); // Try to preload more tweets in a thread
      
      if (longTweets.length === 0) return;
      
      console.log(`Found ${longTweets.length} long tweets to preload in thread ${thread.id}`);
      
      // Preload these tweets one by one to minimize API load
      for (const tweet of longTweets) {
        if (loadingTweets.has(tweet.id)) continue;
        
        try {
          // Mark as loading
          setLoadingTweets(prev => new Set(prev).add(tweet.id));
          
          // Try to get tweet details first
          let details = await fetchTweetDetails(tweet.id, !!tweet.savedAt);
          
          // If that failed, try continuation
          if (!details) {
            details = await fetchTweetContinuation(tweet.id, !!tweet.savedAt);
          }
          
          // If we got details, store them
          if (details) {
            // Process the text to clean it up
            if (details.full_text) {
              details.full_text = details.full_text.replace(/\s*https:\/\/t\.co\/\w+$/g, '');
              details.full_text = details.full_text.replace(/(\s*[…\.]{3,})$/g, '');
            }
            
            console.log(`Preloaded tweet ${tweet.id} with text length: ${details.full_text?.length || 0}`);
            setFullTweets(prev => new Map(prev).set(tweet.id, details));
            
            // Automatically expand preloaded tweets in threads for better readability
            if (!expandedTweets.has(tweet.id) && details.full_text && tweet.full_text && 
                details.full_text.length > tweet.full_text.length + 20) {
              setExpandedTweets(prev => new Set(prev).add(tweet.id));
            }
          }
        } catch (error) {
          console.log(`Preload failed for tweet ${tweet.id}:`, error);
          // Non-critical error, we'll just skip preloading this one
        } finally {
          // Clear loading state
          setLoadingTweets(prev => {
            const newSet = new Set(prev);
            newSet.delete(tweet.id);
            return newSet;
          });
        }
        
        // Add a small delay between preloads to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    };
    
    // Start preloading after a short delay to allow rendering first
    const timer = setTimeout(() => {
      preloadLongTweets();
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [thread.tweets]);
  
  // Always show all tweets in a thread
  const hasMoreTweets = false; // No need to expand further

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const formatDate = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch (error) {
      return dateStr; // Fallback to original string if parsing fails
    }
  };

  // Check if all tweets in the thread are selected
  const allTweetsSelected = thread.tweets.every(tweet => selectedTweets.has(tweet.id));
  const someTweetsSelected = thread.tweets.some(tweet => selectedTweets.has(tweet.id));

  const handleSelectThread = () => {
    onSelectThread(thread, !allTweetsSelected);
  };
  
  // Get the first tweet's author info for display
  const firstTweet = thread.tweets[0];
  const authorInfo = thread.author || firstTweet.author;

  // Helper function to detect if text is likely truncated
  const detectTruncatedText = (text: string): boolean => {
    if (!text) return false;
    
    // Obvious truncation indicators
    if (text.endsWith('…') || text.endsWith('...')) return true;
    if (text.includes('… https://') || text.includes('... https://')) return true;
    
    // Check for non-Latin scripts (like Hindi, Arabic, Chinese, etc.)
    const hasNonLatinScript = /[\u0900-\u097F\u0600-\u06FF\u0590-\u05FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(text);
    
    // For non-Latin scripts, use a lower threshold as they can express more in fewer characters
    const thresholdLength = hasNonLatinScript ? 180 : 240;
    
    // If the text is close to Twitter's limit, it might be truncated
    if (text.length >= thresholdLength) return true;
    
    return false;
  };

  // Check if a tweet text is truncated
  const isTruncated = (tweet: Tweet) => {
    const text = tweet.full_text || tweet.text || '';
    // Use our helper function for better detection across all languages
    return detectTruncatedText(text) || tweet.is_long === true;
  };
  
  // Handle showing more/less content for a specific tweet
  const handleShowMoreClick = async (tweetId: string) => {
    // Toggle expanded state for this tweet
    const newExpandedTweets = new Set(expandedTweets);
    
    if (expandedTweets.has(tweetId)) {
      newExpandedTweets.delete(tweetId);
      setExpandedTweets(newExpandedTweets);
      return;
    } 
    
    // Mark as expanded right away for UI responsiveness
    newExpandedTweets.add(tweetId);
    setExpandedTweets(newExpandedTweets);
    
    const tweet = thread.tweets.find(t => t.id === tweetId);
    if (!tweet) {
      console.error(`Tweet with ID ${tweetId} not found in thread`);
      return;
    }
    
    // If we already have a full version of this tweet with more content than the original
    // no need to fetch again
    const existingFullTweet = fullTweets.get(tweetId);
    if (existingFullTweet && existingFullTweet.full_text) {
      const originalLength = tweet.full_text?.length || tweet.text.length;
      const fullLength = existingFullTweet.full_text.length;
      
      // If the full version is significantly longer or we're dealing with a saved tweet, don't fetch again
      if (fullLength > originalLength + 20 || tweet.savedAt) {
        console.log(`Using existing full content for tweet ${tweetId}: ${fullLength} vs ${originalLength}`);
        return;
      }
    }
    
    // Skip API calls for saved tweets
    if (tweet.savedAt) {
      return; // No need to fetch additional content for saved tweets
    }
    
    if ((tweet.is_long || isTruncated(tweet)) && !loadingTweets.has(tweetId)) {
      // Set loading state for this tweet
      setLoadingTweets(prev => new Set(prev).add(tweetId));
      
      let retryCount = 0;
      const maxRetries = 2;
      const baseDelay = 3000;
      
      const attemptFetch = async () => {
        try {
          // First try direct tweet details as the primary method
          let details = await fetchTweetDetails(tweetId, !!tweet.savedAt);
          
          // Log receipt of tweet details
          console.log(`Received details for tweet ${tweetId}:`, {
            hasDetails: !!details,
            textLength: details?.text?.length || 0,
            fullTextLength: details?.full_text?.length || 0,
            originalFullTextLength: tweet.full_text?.length || 0
          });
          
          // If details method failed or returned insufficient data, try continuation
          if (!details || !details.full_text || (tweet.full_text && details.full_text.length <= tweet.full_text.length)) {
            try {
              const continuationDetails = await fetchTweetContinuation(tweetId, !!tweet.savedAt);
              
              // Log receipt of continuation details
              console.log(`Received continuation for tweet ${tweetId}:`, {
                hasContinuation: !!continuationDetails,
                continuationTextLength: continuationDetails?.text?.length || 0,
                continuationFullTextLength: continuationDetails?.full_text?.length || 0
              });
              
              // Only use continuation data if it's better than what we got from details
              if (continuationDetails && 
                  continuationDetails.full_text && 
                  (!details || !details.full_text || continuationDetails.full_text.length > details.full_text.length)) {
                details = continuationDetails;
              }
            } catch (continuationError) {
              console.error(`Error fetching tweet continuation (attempt ${retryCount + 1}):`, continuationError);
              // If continuation fails but we have details, still use those
            }
          }
          
          if (details) {
            // Process the text to clean it up
            if (details.full_text) {
              details.full_text = details.full_text.replace(/\s*https:\/\/t\.co\/\w+$/g, '');
              details.full_text = details.full_text.replace(/(\s*[…\.]{3,})$/g, '');
              details.full_text = details.full_text.replace(/\n{3,}/g, '\n\n');
            }
            
            // Compare original and new content lengths
            const originalLength = tweet.full_text?.length || tweet.text.length;
            const newLength = details.full_text?.length || 0;
            console.log(`Tweet ${tweetId} content lengths: original=${originalLength}, new=${newLength}, difference=${newLength - originalLength}`);
            
            // Only update if we got significantly more content
            if (newLength > originalLength + 10) {
              setFullTweets(prev => new Map(prev).set(tweetId, details));
              return true; // Success
            } else {
              console.log(`New content not significantly longer for tweet ${tweetId}, using original`);
              return false;
            }
          }
          
          return false; // Failed to get tweet details
        } catch (error) {
          console.error(`Error fetching full tweet (attempt ${retryCount + 1}):`, error);
          
          // Retry with exponential backoff
          if (retryCount < maxRetries) {
            retryCount++;
            const delay = baseDelay * Math.pow(1.5, retryCount - 1);
            console.log(`Will retry fetching tweet ${tweetId} in ${delay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return attemptFetch(); // Recursive retry
          }
          
          return false; // Max retries reached
        }
      };
      
      try {
        await attemptFetch();
      } catch (finalError) {
        console.error('All attempts to fetch tweet failed:', finalError);
        // Log more detailed information for debugging
        console.error('Error details:', {
          tweetId,
          hasFullTweet: fullTweets.has(tweetId),
          isTruncated: tweet ? isTruncated(tweet) : 'Tweet not found'
        });
      } finally {
        // Always clear the loading state
        setLoadingTweets(prev => {
          const newSet = new Set(prev);
          newSet.delete(tweetId);
          return newSet;
        });
      }
    }
  };
  
  // Get the displayed text for a tweet
  const getDisplayText = (tweet: Tweet) => {
    // Check if we have a full version of this tweet
    const fullVersion = fullTweets.get(tweet.id);
    
    // Determine the best text to use
    let textToUse = '';
    
    // Priority order for getting the best text content
    if (fullVersion?.full_text) {
      // First choice: Use the full text from fetched details if available
      textToUse = fullVersion.full_text;
    } else if (tweet.full_text) {
      // Second choice: Use the full_text property if available
      textToUse = tweet.full_text;
    } else {
      // Last resort: Use the regular text
      textToUse = tweet.text;
    }
    
    // Clean up the text - but preserve important URLs
    let fullText = textToUse;
    
    // Only remove t.co URLs that are at the end and are NOT short domain URLs
    // Short domain URLs like bit.ly are important content and should be preserved
    fullText = fullText.replace(/\s*(https:\/\/t\.co\/\w{10,})\s*$/g, '');
    
    // Keep short URLs which are likely bit.ly, tinyurl, etc.
    // Don't remove trailing ellipsis if there's a short URL
    if (!/https?:\/\/(?:bit\.ly|tinyurl|goo\.gl|t\.co)\/\w+/.test(fullText)) {
      // Only then remove trailing ellipsis markers
      fullText = fullText.replace(/(\s*[…\.]{3,})$/g, '');
    }
    
    console.log(`Tweet ${tweet.id} text: original=${tweet.text.length}, full=${fullText.length}, expanded=${expandedTweets.has(tweet.id)}`);
    
    // If tweet is expanded, show full text
    if (expandedTweets.has(tweet.id)) {
      return fullText;
    }
    
    // If tweet is truncated and not expanded, show truncated version
    if (isTruncated(tweet) || fullText.length > 240) {
      // Create a cleaner truncation that doesn't cut words or URLs
      const truncatedLength = Math.min(220, fullText.length / 2);
      let truncatedText = fullText.substring(0, truncatedLength);
      
      // Check if we're cutting in the middle of a URL
      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = fullText.match(urlRegex) || [];
      
      // If there are URLs, make sure we don't cut them
      for (const url of urls) {
        const urlIndex = fullText.indexOf(url);
        // If URL would be cut in the middle, include the full URL or exclude it entirely
        if (urlIndex < truncatedLength && urlIndex + url.length > truncatedLength) {
          if (urlIndex + url.length < truncatedLength + 30) {
            // If including the full URL doesn't add too much length, include it
            truncatedText = fullText.substring(0, urlIndex + url.length);
          } else {
            // Otherwise cut before the URL
            truncatedText = fullText.substring(0, urlIndex);
          }
        }
      }
      
      // Try to end at a word boundary
      const lastSpaceIndex = truncatedText.lastIndexOf(' ');
      if (lastSpaceIndex > truncatedLength * 0.8) { // Only adjust if we're not cutting off too much
        truncatedText = truncatedText.substring(0, lastSpaceIndex);
      }
      
      return truncatedText + '...';
    }
    
    // Otherwise show regular text
    return fullText;
  };

  return (
    <article className="tweet-thread">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Avatar className="w-10 h-10 mr-3 relative profile-media-container">
            <AvatarImage 
              src={authorInfo?.profile_image_url} 
              alt={authorInfo?.name || 'Thread author'} 
              className="object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
              }}
            />
            <AvatarFallback>
              {authorInfo?.name?.charAt(0) || 'T'}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold text-foreground">{authorInfo?.name || 'Thread Author'}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <span>@{authorInfo?.username || 'user'}</span>
              <span>·</span>
              <span className="whitespace-nowrap">{formatDate(firstTweet.created_at)}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center">
          <button 
            onClick={handleSelectThread}
            className="flex items-center text-xs text-muted-foreground hover:text-twitter gap-2 p-2 rounded-md hover:bg-gray-100 transition-colors"
          >
            <CheckSquare className="h-4 w-4" />
            <span className="hidden sm:inline">
              {allTweetsSelected ? 'Deselect Thread' : 'Select Thread'}
            </span>
          </button>
        </div>
      </div>
      
      <div className="thread-container mb-4 space-y-0">
        {visibleTweets.map((tweet, index) => (
          <div 
            key={tweet.id} 
            className="thread-item"
          >
            <div className="absolute -left-3 top-4 w-6 h-6 bg-white rounded-full border-2 border-twitter/30 z-10 flex items-center justify-center text-xs text-twitter">
              {index + 1}
            </div>
            
            <div className="flex items-center mb-2">
              <Checkbox 
                id={`select-${tweet.id}`} 
                checked={selectedTweets.has(tweet.id)}
                onCheckedChange={() => onSelectToggle(tweet)}
                className="h-4 w-4 rounded-md mr-2"
              />
              <label 
                htmlFor={`select-${tweet.id}`}
                className="text-xs text-muted-foreground"
              >
                <span className="hidden sm:inline">Select this tweet</span>
                <span className="sm:hidden">Select</span>
              </label>
            </div>
            
            <div className="text-foreground whitespace-pre-line text-sm sm:text-base">
              {loadingTweets.has(tweet.id) ? (
                <p className="text-muted-foreground">Loading full tweet content...</p>
              ) : (
                <>
                  {getDisplayText(tweet)}
                  
                  {/* Show more/less button if needed */}
                  {(isTruncated(tweet) || (tweet.full_text || tweet.text || '').length > 240 || fullTweets.has(tweet.id)) && (
                    <button 
                      onClick={() => handleShowMoreClick(tweet.id)}
                      className="mt-2 text-blue-500 hover:text-blue-700 text-sm font-medium flex items-center"
                      disabled={loadingTweets.has(tweet.id)}
                    >
                      {loadingTweets.has(tweet.id) ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Loading...
                        </span>
                      ) : (
                        expandedTweets.has(tweet.id) ? (
                          <>Show less <ChevronUp className="h-4 w-4 ml-1" /></>
                        ) : (
                          <>Show more <ChevronDown className="h-4 w-4 ml-1" /></>
                        )
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
            
            {tweet.media && tweet.media.length > 0 && (
              <div className="mt-3">
                <MediaDisplay media={tweet.media} />
              </div>
            )}
            
            {/* Display quoted tweet if exists */}
            {tweet.referenced_tweets && tweet.referenced_tweets.length > 0 && tweet.referenced_tweets[0].type === 'quoted' && (
              <div className="mt-3 border border-gray-200 rounded-lg p-3">
                <div className="flex items-center mb-2">
                  {tweet.referenced_tweets[0].author?.profile_image_url && (
                    <img 
                      src={tweet.referenced_tweets[0].author.profile_image_url} 
                      alt={tweet.referenced_tweets[0].author.name || "Quoted user"} 
                      className="w-6 h-6 rounded-full mr-2 object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
                      }}
                    />
                  )}
                  <div>
                    <div className="font-semibold text-xs">{tweet.referenced_tweets[0].author?.name}</div>
                    <div className="text-xs text-muted-foreground">
                      @{tweet.referenced_tweets[0].author?.username}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-foreground whitespace-pre-line">
                  {tweet.referenced_tweets[0].text}
                </p>
                {tweet.referenced_tweets[0].media && tweet.referenced_tweets[0].media.length > 0 && (
                  <div className="mt-2">
                    <MediaDisplay media={tweet.referenced_tweets[0].media} />
                  </div>
                )}
              </div>
            )}
            
            <div className="flex mt-2 pt-2 justify-between text-xs text-muted-foreground">
              <div className="flex items-center">
                <MessageSquare className="h-3 w-3 mr-1" />
                <span>{tweet.reply_count || 0}</span>
              </div>
              <div className="flex items-center">
                <RefreshCw className="h-3 w-3 mr-1" />
                <span>{tweet.retweet_count || 0}</span>
              </div>
              <div className="flex items-center">
                <Heart className="h-3 w-3 mr-1" />
                <span>{tweet.favorite_count || 0}</span>
              </div>
              <div className="flex items-center">
                <Share className="h-3 w-3 mr-1" />
                <span>{tweet.quote_count || 0}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
};

export default TweetThread;
