import React, { useState, useEffect, useMemo } from 'react';
import { Tweet } from '@/utils/types';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchTweetDetails, fetchTweetContinuation } from '@/utils/api';
import { MessageSquare, Heart, RefreshCw, Share, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import MediaDisplay from './MediaDisplay';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/components/ui/use-toast';

interface TweetCardProps {
  tweet: Tweet;
  isSelected: boolean;
  onSelectToggle: (tweet: Tweet) => void;
}

const TweetCard: React.FC<TweetCardProps> = ({ tweet, isSelected, onSelectToggle }) => {
  const [expanded, setExpanded] = useState(false);
  const [fullTweet, setFullTweet] = useState<Tweet | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFullContent, setShowFullContent] = useState(false);
  const [isLoadingFullTweet, setIsLoadingFullTweet] = useState(false);
  
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
  
  // Check if tweet text is truncated
  const isTruncated = React.useMemo(() => {
    const text = tweet.full_text || tweet.text || '';
    // Use our helper function for better detection across all languages
    return detectTruncatedText(text) || tweet.is_long === true;
  }, [tweet]);
  
  // Preload logic for long tweets - using staggered loading with backoff
  useEffect(() => {
    // Skip preloading for saved tweets that already have content
    if (tweet.savedAt) {
      return;
    }

    // Only load if it's a long tweet that isn't already loading
    if (!isLoadingFullTweet && (tweet.is_long || isTruncated)) {
      // Apply a random initial delay to stagger loading of tweets
      // This prevents all tweets from loading at once and hitting rate limits
      const initialDelay = 1000 + Math.random() * 2000;
      
      let loadingTimer = setTimeout(async () => {
        setIsLoadingFullTweet(true);
        
        let retryCount = 0;
        const maxRetries = 2;
        const baseDelay = 2500;
        
        const attemptFetch = async () => {
          try {
            // First try to get the tweet details
            const details = await fetchTweetDetails(tweet.id, !!tweet.savedAt);
            
            if (details && details.full_text) {
              setFullTweet(details);
              return true;
            }
            
            // If getting details failed, try continuation as fallback
            const continuationDetails = await fetchTweetContinuation(tweet.id, !!tweet.savedAt);
            
            if (continuationDetails && continuationDetails.full_text) {
              setFullTweet(continuationDetails);
              return true;
            }
            
            return false;
          } catch (error) {
            console.error(`Error preloading full tweet content (attempt ${retryCount + 1}):`, error);
            
            // Implement retry logic with exponential backoff
            if (retryCount < maxRetries) {
              retryCount++;
              const delay = baseDelay * Math.pow(1.5, retryCount - 1);
              
              await new Promise(resolve => setTimeout(resolve, delay));
              return attemptFetch(); // Recursive retry
            }
            
            return false;
          }
        };
        
        await attemptFetch();
        setIsLoadingFullTweet(false);
      }, initialDelay);
      
      return () => clearTimeout(loadingTimer);
    }
  }, [tweet, isLoadingFullTweet]);

  // Handle click on "Show more" button
  const handleShowMoreClick = async () => {
    // If we already have the full tweet, just toggle expanded state
    if (fullTweet) {
      setShowFullContent(!showFullContent);
      return;
    }
    
    // For saved tweets, we don't need to fetch additional content
    if (tweet.savedAt) {
      setShowFullContent(true);
      return;
    }
    
    // Otherwise, we need to fetch the full tweet
    setIsLoadingFullTweet(true);
    
    try {
      // First try to get the tweet details
      const details = await fetchTweetDetails(tweet.id, !!tweet.savedAt);
      
      if (details && details.full_text) {
        setFullTweet(details);
        setShowFullContent(true);
        setIsLoadingFullTweet(false);
        return;
      }
      
      // If getting details failed, try continuation as fallback
      const continuationDetails = await fetchTweetContinuation(tweet.id, !!tweet.savedAt);
      
      if (continuationDetails && continuationDetails.full_text) {
        setFullTweet(continuationDetails);
        setShowFullContent(true);
        setIsLoadingFullTweet(false);
        return;
      }
      
      // If both methods failed, show an error
      toast({
        title: 'Error',
        description: 'Unable to load full tweet content. Please try again later.',
        variant: 'destructive',
      });
    } catch (error) {
      console.error('Error loading full tweet content:', error);
      toast({
        title: 'Error',
        description: 'Failed to load full tweet content. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingFullTweet(false);
    }
  };

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  const formatDate = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch (error) {
      return dateStr; // Fallback to original string if parsing fails
    }
  };

  // Determine which text content to display
  const displayText = useMemo(() => {
    // Log text options for debugging
    console.log(`Tweet ${tweet.id} display options:`, {
      showFullContent,
      hasFullTweet: !!fullTweet,
      originalTextLength: tweet.text.length,
      originalFullTextLength: tweet.full_text?.length || 0,
      fullTweetTextLength: fullTweet?.full_text?.length || 0
    });
    
    let textContent = '';
    
    // Always prefer full text from fully loaded tweet if available and showing full content
    if (showFullContent && fullTweet?.full_text) {
      textContent = fullTweet.full_text;
    }
    // For saved tweets, prefer the full_text property when available
    else if (tweet.savedAt && tweet.full_text) {
      textContent = showFullContent ? tweet.full_text : tweet.text;
    }
    // Next preference is the original full_text if available
    else if (tweet.full_text && tweet.full_text.length > tweet.text.length + 5) {
      textContent = showFullContent ? tweet.full_text : tweet.text;
    }
    // Default to regular text
    else {
      textContent = tweet.text;
    }
    
    // Preserve short URLs (like bit.ly) which are important content
    // Only remove t.co URLs with long random strings, which are Twitter's internal tracking URLs
    if (!textContent.includes('http://bit.ly') && !textContent.includes('https://bit.ly')) {
      textContent = textContent.replace(/\s*(https:\/\/t\.co\/\w{10,})\s*$/g, '');
    }
    
    // Check if text contains short URLs which should be preserved (bit.ly, tinyurl, etc.)
    const hasShortUrl = /https?:\/\/(?:bit\.ly|tinyurl|goo\.gl|t\.co)\/\w+/.test(textContent);
    
    // Only clean trailing ellipses if there's no short URL that might be cut off
    if (!hasShortUrl) {
      textContent = textContent.replace(/(\s*[…\.]{3,})$/g, '');
    }
    
    return textContent;
  }, [tweet.text, tweet.full_text, fullTweet, showFullContent, tweet.id, tweet.savedAt]);

  // Check if we should display "Show more" button
  const showMoreButton = useMemo(() => {
    // For saved tweets, check if full_text is significantly longer than text
    if (tweet.savedAt && tweet.full_text) {
      return tweet.full_text.length > tweet.text.length + 20;
    }
    
    // If we have a full tweet, check if it has different content
    if (fullTweet?.full_text) {
      return fullTweet.full_text.length > tweet.text.length + 20;
    }
    
    // Otherwise, check if the tweet is flagged as long or has a longer full_text
    return tweet.is_long || (tweet.full_text && tweet.full_text.length > tweet.text.length + 20) || isTruncated;
  }, [tweet, fullTweet, isTruncated]);

  return (
    <article className="tweet-card animate-fade-in">
      <div className="checkbox-container sm:top-6 sm:right-6 top-4 right-4">
        <Checkbox 
          id={`select-${tweet.id}`} 
          checked={isSelected}
          onCheckedChange={() => onSelectToggle(tweet)}
          className="h-5 w-5 rounded-md"
        />
        <label 
          htmlFor={`select-${tweet.id}`}
          className="text-xs text-muted-foreground hidden sm:inline"
        >
          Select
        </label>
      </div>
      
      <div className="flex flex-col space-y-1.5">
        {tweet.author && (
          <div className="flex items-center">
            <div className="flex gap-2 items-center flex-1">
              <Avatar className="h-8 w-8 relative profile-media-container">
                <AvatarImage 
                  src={tweet.author.profile_image_url} 
                  alt={tweet.author.name}
                  className="object-cover"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
                  }}
                />
                <AvatarFallback>
                  {tweet.author.name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col text-sm">
                <span className="font-semibold line-clamp-1">{tweet.author.name}</span>
                <span className="text-muted-foreground text-xs">@{tweet.author.username}</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground flex items-center">
              {formatDate(tweet.created_at)}
              {tweet.savedAt && (
                <span className="ml-2 text-xs text-muted-foreground/70">
                  · Saved {formatDistanceToNow(new Date(tweet.savedAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Tweet Text Content */}
      <div className="mb-3 sm:mb-4">
        {isLoadingFullTweet ? (
          <div className="p-2 flex justify-center items-center">
            <Loader2 className="h-4 w-4 mr-2 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground text-sm">Loading full content...</p>
          </div>
        ) : (
          <>
            <div className="text-sm mb-2 whitespace-pre-wrap break-words">
              {displayText}
              
              {/* Show more/less button if content is long */}
              {showMoreButton && (
                <button
                  onClick={handleShowMoreClick}
                  className="ml-1 text-blue-500 hover:text-blue-700 text-xs font-semibold inline-flex items-center"
                  disabled={isLoadingFullTweet}
                >
                  {isLoadingFullTweet ? (
                    <span className="flex items-center">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Loading...
                    </span>
                  ) : (
                    <>
                      {showFullContent ? (
                        <>Show less <ChevronUp className="h-3 w-3 ml-1" /></>
                      ) : (
                        <>Show more <ChevronDown className="h-3 w-3 ml-1" /></>
                      )}
                    </>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      
      {tweet.media && tweet.media.length > 0 && (
        <div className="mt-3 sm:mt-4 mb-3 sm:mb-4">
          <MediaDisplay media={tweet.media} />
        </div>
      )}
      
      {tweet.referenced_tweets && tweet.referenced_tweets.length > 0 && tweet.referenced_tweets[0].type === 'quoted' && (
        <div className="mt-3 sm:mt-4 mb-3 sm:mb-4 border border-gray-200 rounded-lg p-3 sm:p-4 bg-gray-50">
          <div className="flex items-center mb-2">
            {tweet.referenced_tweets[0].author?.profile_image_url && (
              <img 
                src={tweet.referenced_tweets[0].author.profile_image_url} 
                alt={tweet.referenced_tweets[0].author.name || "Quoted user"} 
                className="w-6 h-6 sm:w-8 sm:h-8 rounded-full mr-2 object-cover"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
                }}
              />
            )}
            <div>
              <div className="font-semibold text-xs sm:text-sm">{tweet.referenced_tweets[0].author?.name}</div>
              <div className="text-xs text-muted-foreground">
                @{tweet.referenced_tweets[0].author?.username}
              </div>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-foreground whitespace-pre-line">
            {tweet.referenced_tweets[0].text}
          </p>
          {tweet.referenced_tweets[0].media && tweet.referenced_tweets[0].media.length > 0 && (
            <div className="mt-2 sm:mt-3">
              <MediaDisplay media={tweet.referenced_tweets[0].media} />
            </div>
          )}
        </div>
      )}
      
      <div className="mt-3 sm:mt-4 text-xs sm:text-sm text-muted-foreground">
        {formatDate(tweet.created_at)}
      </div>
      
      <div className="flex mt-3 sm:mt-4 pt-3 border-t border-border justify-between">
        <div className="flex items-center text-muted-foreground">
          <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="text-xs sm:text-sm">{tweet.reply_count || 0}</span>
        </div>
        <div className="flex items-center text-muted-foreground">
          <RefreshCw className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="text-xs sm:text-sm">{tweet.retweet_count || 0}</span>
        </div>
        <div className="flex items-center text-muted-foreground">
          <Heart className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="text-xs sm:text-sm">{tweet.favorite_count || 0}</span>
        </div>
        <div className="flex items-center text-muted-foreground">
          <Share className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="text-xs sm:text-sm">{tweet.quote_count || 0}</span>
        </div>
      </div>
    </article>
  );
};

export default TweetCard;
