import React, { useState } from 'react';
import { Tweet, Thread } from '@/utils/types';
import { Checkbox } from '@/components/ui/checkbox';
import MediaDisplay from './MediaDisplay';
import { MessageSquare, Heart, RefreshCw, Share, ChevronDown, ChevronUp, CheckSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

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
  
  // Ensure thread has tweets array
  if (!thread || !thread.tweets || thread.tweets.length === 0) {
    console.error("Thread is empty or missing tweets array");
    return null;
  }
  
  // Log thread info for debugging
  console.log(`Thread ${thread.id} has ${thread.tweets.length} tweets`);
  
  // Always show all tweets in a thread
  const visibleTweets = thread.tweets;
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
              {tweet.full_text || tweet.text}
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
                <span>{tweet.public_metrics.reply_count}</span>
              </div>
              <div className="flex items-center">
                <RefreshCw className="h-3 w-3 mr-1" />
                <span>{tweet.public_metrics.retweet_count}</span>
              </div>
              <div className="flex items-center">
                <Heart className="h-3 w-3 mr-1" />
                <span>{tweet.public_metrics.like_count}</span>
              </div>
              <div className="flex items-center">
                <Share className="h-3 w-3 mr-1" />
                <span>{tweet.public_metrics.quote_count}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
};

export default TweetThread;
