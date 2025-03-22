import React, { useState, useEffect } from 'react';
import { Tweet } from '@/utils/types';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchTweetDetails } from '@/utils/api';
import { MessageSquare, Heart, RefreshCw, Share, ChevronDown, ChevronUp } from 'lucide-react';
import MediaDisplay from './MediaDisplay';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { formatDistanceToNow } from 'date-fns';

interface TweetCardProps {
  tweet: Tweet;
  isSelected: boolean;
  onSelectToggle: (tweet: Tweet) => void;
}

const TweetCard: React.FC<TweetCardProps> = ({ tweet, isSelected, onSelectToggle }) => {
  const [expanded, setExpanded] = useState(false);
  const [fullTweet, setFullTweet] = useState<Tweet | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFullContent, setShowFullContent] = useState(!tweet.is_long);
  
  // For very long tweets, automatically fetch full details
  useEffect(() => {
    const autoFetchDetails = async () => {
      // If this is a long tweet and we don't have the full content
      if (tweet.is_long && (!tweet.full_text || tweet.full_text.length <= tweet.text.length)) {
        setLoading(true);
        try {
          const details = await fetchTweetDetails(tweet.id);
          if (details) {
            setFullTweet(details);
          }
        } catch (error) {
          console.error('Error auto-fetching full tweet:', error);
        } finally {
          setLoading(false);
        }
      }
    };
    
    autoFetchDetails();
  }, [tweet]);

  const handleExpandClick = () => {
    if (tweet.is_long && !showFullContent) {
      setShowFullContent(true);
    } else {
      setExpanded(!expanded);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch (error) {
      return dateStr; // Fallback to original string if parsing fails
    }
  };

  // Get the full text to display
  const displayText = fullTweet?.full_text || tweet.full_text || tweet.text;
  
  // If we should show a truncated version
  const truncatedText = !showFullContent && displayText.length > 280 
    ? displayText.substring(0, 280) + '...' 
    : displayText;

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
      
      <div className="mb-3 sm:mb-4">
        {loading ? (
          <div className="p-4 text-center">
            <p className="text-muted-foreground">Loading full tweet content...</p>
          </div>
        ) : (
          <>
            <p className="text-foreground whitespace-pre-line text-sm sm:text-base">
              {showFullContent ? displayText : truncatedText}
            </p>
            
            {tweet.is_long && (
              <button 
                onClick={handleExpandClick}
                className="show-more-button mt-2 text-twitter hover:underline flex items-center"
              >
                {showFullContent ? (
                  <>Show less <ChevronUp className="h-4 w-4 ml-1" /></>
                ) : (
                  <>Show more <ChevronDown className="h-4 w-4 ml-1" /></>
                )}
              </button>
            )}
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
          <span className="text-xs sm:text-sm">{tweet.public_metrics.reply_count}</span>
        </div>
        <div className="flex items-center text-muted-foreground">
          <RefreshCw className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="text-xs sm:text-sm">{tweet.public_metrics.retweet_count}</span>
        </div>
        <div className="flex items-center text-muted-foreground">
          <Heart className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="text-xs sm:text-sm">{tweet.public_metrics.like_count}</span>
        </div>
        <div className="flex items-center text-muted-foreground">
          <Share className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="text-xs sm:text-sm">{tweet.public_metrics.quote_count}</span>
        </div>
      </div>
    </article>
  );
};

export default TweetCard;
