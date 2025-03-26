import React, { useState, useEffect, useMemo, useCallback } from 'react';
import TweetCard from '@/components/TweetCard';
import TweetThread from '@/components/TweetThread';
import { Button } from '@/components/ui/button';
import { Tweet, TweetCategory, Thread } from '@/utils/types';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Database, Trash2, User, ArrowLeft, MessageSquare, FileText, Rows3, MessagesSquare } from 'lucide-react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from 'date-fns';

interface ApiResponse {
  success: boolean;
  count: number;
  data: (Tweet | Thread)[];
}

const BACKEND_API_URL = 'https://twitter-aee7.onrender.com/api/tweets';

interface SavedTweetsProps {
  username?: string;
}

interface CategoryInfo {
  label: string;
  icon: React.ReactNode;
  count: number;
}

// Helper function to convert Twitter API date to Date object
const parseTwitterDate = (twitterDate: string): Date => {
  // Twitter API date format: "Tue Feb 02 17:43:22 +0000 2021" or ISO format
  if (twitterDate.includes('+0000')) {
    return new Date(twitterDate);
  }
  // Handle ISO format or other formats
  return new Date(twitterDate);
};

const SavedTweets: React.FC<SavedTweetsProps> = ({ username }) => {
  const [savedTweets, setSavedTweets] = useState<Tweet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<TweetCategory | 'all'>('all');
  const { toast } = useToast();
  const params = useParams<{ username?: string }>();
  const userParam = params.username || username;
  const navigate = useNavigate();
  const [directThreads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    fetchSavedTweets();
  }, [userParam]);

  const fetchSavedTweets = useCallback(async () => {
    setIsLoading(true);
    try {
      const endpoint = userParam 
        ? `${BACKEND_API_URL}/saved/user/${userParam}` 
        : `${BACKEND_API_URL}/saved`;
      
      console.log(`Fetching saved tweets from: ${endpoint}`);
      const response = await fetch(endpoint);
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }
      
      const data: ApiResponse = await response.json();
      
      console.log('Received saved tweets from backend:', {
        success: data.success,
        count: data.count,
        dataLength: data.data?.length || 0
      });
      
      if (!data.data || data.data.length === 0) {
        console.log('No saved tweets returned from backend');
        setSavedTweets([]);
        setThreads([]);
        return;
      }
      
      // Process the data - could be either individual tweets or thread objects
      let processedData: Tweet[] = [];
      let threadObjects: Thread[] = [];
      const processedTweetIds = new Set<string>(); // Track which tweets are already in threads
      
      // Sort all data by creation date first (newest first)
      const sortedData = [...data.data].sort((a, b) => {
        // Both are tweets or both are threads
        const aDate = new Date('created_at' in a ? a.created_at : a.tweets[0].created_at).getTime();
        const bDate = new Date('created_at' in b ? b.created_at : b.tweets[0].created_at).getTime();
        
        if (isNaN(aDate) || isNaN(bDate)) {
          // Fallback to ID comparison if dates can't be parsed
          const aId = 'id' in a ? a.id : (a as Thread).tweets[0].id;
          const bId = 'id' in b ? b.id : (b as Thread).tweets[0].id;
          return Number(BigInt(bId) - BigInt(aId));
        }
        
        return bDate - aDate; // Newest first
      });
      
      // First process threads
      sortedData.forEach(item => {
        if ('tweets' in item && Array.isArray(item.tweets) && item.tweets.length > 0) {
          // This is a thread object
          console.log(`Processing thread ${item.id} with ${item.tweets.length} tweets`);
          
          // Sort tweets within the thread by thread position or date
          const sortedThreadTweets = [...item.tweets].sort((a, b) => {
            // First by thread_position if available
            if (a.thread_position !== undefined && b.thread_position !== undefined) {
              return a.thread_position - b.thread_position;
            }
            
            if (a.thread_index !== undefined && b.thread_index !== undefined) {
              return a.thread_index - b.thread_index;
            }
            
            // Then try by created_at
            try {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            } catch (e) {
              // Fallback to ID comparison for chronological order
              return Number(BigInt(a.id) - BigInt(b.id));
            }
          });
          
          // Create a new thread object with sorted tweets
          const thread: Thread = {
            ...item,
            tweets: sortedThreadTweets
          };
          
          threadObjects.push(thread);
          
          // Mark all tweets in this thread as processed
          sortedThreadTweets.forEach(tweet => {
            processedTweetIds.add(tweet.id);
          });
        }
      });
      
      // Then process individual tweets, excluding those already in threads
      sortedData.forEach(item => {
        if (!('tweets' in item) && !processedTweetIds.has(item.id)) {
          // Add additional debugging for potential tweet type issues
          if (!item.id || !item.created_at) {
            console.warn('Found invalid tweet object:', item);
          } else {
            processedData.push(item as Tweet);
          }
        }
      });
      
      console.log(`Processed ${processedData.length} individual tweets and ${threadObjects.length} threads`);
      
      // Sort individual tweets by date (newest first)
      processedData.sort((a, b) => {
        try {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        } catch (e) {
          // Fallback to ID comparison
          return Number(BigInt(b.id) - BigInt(a.id));
        }
      });
      
      // Debug check for savedAt property
      const hasSavedAt = processedData.some(tweet => tweet.savedAt);
      console.log(`Individual tweets have savedAt property: ${hasSavedAt}`);
      
      if (threadObjects.length > 0) {
        const firstThread = threadObjects[0];
        const threadHasSavedAt = firstThread.savedAt !== undefined;
        const threadsHaveSavedAt = threadObjects.some(thread => thread.savedAt !== undefined);
        console.log(`First thread has savedAt: ${threadHasSavedAt}, any thread has savedAt: ${threadsHaveSavedAt}`);
        
        if (firstThread.tweets && firstThread.tweets.length > 0) {
          const firstTweetInThread = firstThread.tweets[0];
          console.log(`First tweet in first thread: ${JSON.stringify({
            id: firstTweetInThread.id,
            date: firstTweetInThread.created_at,
            hasSavedAt: firstTweetInThread.savedAt !== undefined,
            threadId: firstTweetInThread.thread_id,
            threadIndex: firstTweetInThread.thread_index
          })}`);
        }
      }
      
      // Set both the individual tweets and thread objects
      setSavedTweets(processedData);
      setThreads(threadObjects);
    } catch (error) {
      console.error('Error fetching saved tweets:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch saved tweets',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [userParam, toast]);

  const handleDeleteTweet = async (id: string) => {
    setIsDeleting(prev => ({ ...prev, [id]: true }));
    try {
      const response = await fetch(`${BACKEND_API_URL}/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`Error deleting tweet: ${response.status}`);
      }
      
      setSavedTweets(prev => prev.filter(tweet => tweet.id !== id));
      
      toast({
        title: 'Success',
        description: 'Tweet removed from saved collection',
      });
    } catch (error) {
      console.error('Error deleting tweet:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete saved tweet',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDeleteThread = async (thread: Thread) => {
    // Mark all tweets in the thread as deleting
    const updatedIsDeleting = { ...isDeleting };
    thread.tweets.forEach(tweet => {
      updatedIsDeleting[tweet.id] = true;
    });
    setIsDeleting(updatedIsDeleting);
    
    try {
      // Delete each tweet in the thread
      const deletePromises = thread.tweets.map(tweet => 
        fetch(`${BACKEND_API_URL}/${tweet.id}`, {
          method: 'DELETE',
        })
      );
      
      // Wait for all delete operations to complete
      const results = await Promise.all(deletePromises);
      
      // Check if any operations failed
      if (results.some(response => !response.ok)) {
        throw new Error("Some tweets could not be deleted");
      }
      
      // Update state to remove the deleted tweets
      setSavedTweets(prev => prev.filter(tweet => 
        !thread.tweets.some(threadTweet => threadTweet.id === tweet.id)
      ));
      
      toast({
        title: 'Success',
        description: `Thread with ${thread.tweets.length} tweets removed`,
      });
    } catch (error) {
      console.error('Error deleting thread:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete thread completely',
        variant: 'destructive',
      });
    } finally {
      // Clear the deleting state for all tweets in the thread
      const clearedIsDeleting = { ...isDeleting };
      thread.tweets.forEach(tweet => {
        clearedIsDeleting[tweet.id] = false;
      });
      setIsDeleting(clearedIsDeleting);
    }
  };

  const handleBack = () => {
    navigate('/saved'); // Go back to the users list
  };

  // Get avatar from the first tweet if available
  const userAvatar = savedTweets.length > 0 ? savedTweets[0].author.profile_image_url : null;

  // Group tweets into categories: normal, long, and threads
  const { normalTweets, longTweets, threads } = useMemo(() => {
    // If we already have thread objects from the backend, use those directly
    if (directThreads.length > 0) {
      // Extract normal and long tweets
      const normalTweets: Tweet[] = [];
      const longTweets: Tweet[] = [];
      
      savedTweets.forEach(tweet => {
        if (tweet.is_long) {
          longTweets.push(tweet);
        } else {
          normalTweets.push(tweet);
        }
      });
      
      console.log(`Using ${directThreads.length} threads directly from the backend`);
      
      return { normalTweets, longTweets, threads: directThreads };
    }
    
    // Otherwise fall back to the original thread detection logic
    const normalTweets: Tweet[] = [];
    const longTweets: Tweet[] = [];
    const threadMap = new Map<string, Tweet[]>();
    const processedTweetIds = new Set<string>(); // Track which tweets are already in threads
    
    // First, identify tweets with thread_id and group them
    savedTweets.forEach(tweet => {
      if (tweet.thread_id) {
        const threadId = tweet.thread_id;
        const existingThread = threadMap.get(threadId) || [];
        existingThread.push(tweet);
        threadMap.set(threadId, existingThread);
        processedTweetIds.add(tweet.id);
      }
    });
    
    // Then look for conversations that should be threads
    const conversationMap = new Map<string, Tweet[]>();
    
    // Group by conversation_id
    savedTweets.forEach(tweet => {
      if (!processedTweetIds.has(tweet.id) && tweet.conversation_id) {
        const conversationId = tweet.conversation_id;
        const existingConversation = conversationMap.get(conversationId) || [];
        existingConversation.push(tweet);
        conversationMap.set(conversationId, existingConversation);
      }
    });
    
    // Convert appropriate conversations to threads
    conversationMap.forEach((tweets, conversationId) => {
      if (tweets.length > 1) {
        // Group tweets by author
        const authorTweets = new Map<string, Tweet[]>();
        
        tweets.forEach(tweet => {
          const authorId = tweet.author.id;
          const authorThreadTweets = authorTweets.get(authorId) || [];
          authorThreadTweets.push(tweet);
          authorTweets.set(authorId, authorThreadTweets);
        });
        
        // For each author with multiple tweets, create a thread
        authorTweets.forEach((authorTweetGroup, authorId) => {
          if (authorTweetGroup.length > 1) {
            const threadId = `${conversationId}-${authorId}`;
            threadMap.set(threadId, authorTweetGroup);
            
            // Mark these tweets as processed
            authorTweetGroup.forEach(tweet => {
              processedTweetIds.add(tweet.id);
            });
          }
        });
      }
    });
    
    // Categorize remaining tweets as normal or long
    savedTweets.forEach(tweet => {
      if (!processedTweetIds.has(tweet.id)) {
        if (tweet.is_long) {
          longTweets.push(tweet);
        } else {
          normalTweets.push(tweet);
        }
      }
    });
    
    // Build thread objects
    const threads: Thread[] = Array.from(threadMap.entries())
      .filter(([_, tweets]) => tweets.length > 1) // Only include actual threads with multiple tweets
      .map(([threadId, tweets]) => {
        // Sort tweets within the thread by thread_index if available, or by created_at (chronological order)
        const sortedTweets = tweets.sort((a, b) => {
          // First check if both tweets have thread_index
          if (a.thread_index !== undefined && b.thread_index !== undefined) {
            return a.thread_index - b.thread_index;
          }
          
          // Otherwise parse dates more carefully to ensure correct ordering
          try {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            // If a date can't be parsed correctly, fall back to ID-based ordering
            if (isNaN(dateA) || isNaN(dateB)) {
              // Use tweet IDs which are chronological in Twitter's system
              return Number(BigInt(a.id) - BigInt(b.id));
            }
            return dateA - dateB;
          } catch (e) {
            // Fallback to ID comparison if date parsing fails
            return Number(BigInt(a.id) - BigInt(b.id));
          }
        });
        
        // Make sure thread has the full text contents
        const processedTweets = sortedTweets.map(tweet => {
          // If tweet has a link at the end but also has full_text, remove the link from display
          if (tweet.full_text) {
            // Process the full_text to ensure we're displaying the complete content
            // without truncated URL references
            let processedText = tweet.full_text;
            
            // Remove trailing t.co links that Twitter adds
            processedText = processedText.replace(/https:\/\/t\.co\/\w+\s*$/g, '');
            
            return {
              ...tweet,
              // Use the processed text without the trailing URL
              text: processedText,
              full_text: processedText
            };
          }
          return tweet;
        });
        
        // Use the first tweet's author info for the thread metadata
        // This is more reliable for finding the thread origin
        const firstTweet = processedTweets[0];
        
        return {
          id: threadId,
          tweets: processedTweets,
          author: firstTweet.author,
          created_at: firstTweet.created_at
        };
    });
    
    // Sort threads by their first tweet's date (newest first)
    threads.sort((a, b) => {
      try {
        const dateA = new Date(a.created_at || '').getTime();
        const dateB = new Date(b.created_at || '').getTime();
        if (isNaN(dateA) || isNaN(dateB)) {
          // If dates can't be parsed, sort threads so most recent tweets appear first
          // Using the ID of the first tweet in each thread
          return Number(BigInt(b.tweets[0].id) - BigInt(a.tweets[0].id));
        }
        return dateB - dateA;
      } catch (e) {
        // Fallback to first tweet ID comparison
        return Number(BigInt(b.tweets[0].id) - BigInt(a.tweets[0].id));
      }
    });
    
    // Debug logging
    console.log(`Created ${threads.length} threads through local detection`);
    
    return { normalTweets, longTweets, threads };
  }, [savedTweets, directThreads]);

  // Determine which content to display based on active category
  const { displayThreads, displayTweets } = useMemo(() => {
    let displayThreads: Thread[] = [];
    let displayTweets: Tweet[] = [];
    
    if (activeCategory === 'all') {
      displayThreads = threads;
      displayTweets = normalTweets.concat(longTweets);
    } else if (activeCategory === 'thread') {
      displayThreads = threads;
    } else if (activeCategory === 'long') {
      displayTweets = longTweets;
    } else { // 'normal'
      displayTweets = normalTweets;
    }
    
    return { displayThreads, displayTweets };
  }, [threads, normalTweets, longTweets, activeCategory]);

  // Format tweet date for display
  const formatTweetDate = (dateString: string): string => {
    try {
      const date = parseTwitterDate(dateString);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      return dateString; // Fallback to original string if parsing fails
    }
  };

  // Generate category info for tabs
  const categories: Record<string, CategoryInfo> = useMemo(() => {
    // Count total tweets across all threads
    const totalThreadTweets = threads.reduce((acc, thread) => acc + thread.tweets.length, 0);
    const totalTweetCount = savedTweets.length + totalThreadTweets;
    
    return {
      all: {
        label: 'All Tweets',
        icon: <Rows3 className="h-4 w-4" />,
        count: totalTweetCount
      },
      normal: {
        label: 'Normal',
        icon: <MessageSquare className="h-4 w-4" />,
        count: normalTweets.length
      },
      long: {
        label: 'Long',
        icon: <FileText className="h-4 w-4" />,
        count: longTweets.length
      },
      thread: {
        label: 'Threads',
        icon: <MessagesSquare className="h-4 w-4" />,
        count: threads.length // Count number of threads, not tweets in threads
      }
    };
  }, [savedTweets, normalTweets, longTweets, threads]);

  // Debug logging - remove in production
  useEffect(() => {
    if (threads.length > 0) {
      const totalTweetsInThreads = threads.reduce((acc, thread) => acc + thread.tweets.length, 0);
      console.log(`Found ${threads.length} threads with ${totalTweetsInThreads} total tweets`);
      threads.forEach((thread, i) => {
        console.log(`Thread ${i+1}: ${thread.id} has ${thread.tweets.length} tweets`);
      });
    }
  }, [threads]);

  // Check if we need to show empty state
  const isEmpty = useMemo(() => {
    return !isLoading && savedTweets.length === 0 && threads.length === 0;
  }, [isLoading, savedTweets, threads]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="p-4 sm:p-6 rounded-lg bg-card border mb-4 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-3 sm:space-x-4">
            {userAvatar ? (
              <img 
                src={userAvatar} 
                alt={userParam || "User"} 
                className="w-12 h-12 sm:w-16 sm:h-16 rounded-full object-cover"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
                }}
              />
            ) : (
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center">
                <User className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
              </div>
            )}
            
            <div>
              <h2 className="text-xl sm:text-2xl font-bold mb-0 sm:mb-1 text-foreground truncate max-w-[200px] sm:max-w-none">
                @{userParam}
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground">
                {categories.all.count} saved {categories.all.count === 1 ? 'tweet' : 'tweets'} 
                {threads.length > 0 && ` (${threads.length} ${threads.length === 1 ? 'thread' : 'threads'})`}
              </p>
            </div>
          </div>
          
          <Button 
            onClick={handleBack}
            variant="outline"
            size="sm"
            className="flex items-center gap-1 w-full sm:w-auto justify-center"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Users</span>
          </Button>
        </div>
        
        {isLoading ? (
          <div className="flex justify-center items-center py-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <span className="ml-2 text-lg font-medium">Loading saved tweets...</span>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col justify-center items-center py-16 space-y-4">
            <Database className="h-16 w-16 text-muted-foreground" />
            <h3 className="text-xl font-semibold">No saved tweets found</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {userParam 
                ? `@${userParam} hasn't saved any tweets yet.` 
                : "You haven't saved any tweets yet. Browse tweets and click the save button to add them here."}
            </p>
            {!userParam && (
              <Button asChild variant="outline" className="mt-4">
                <Link to="/">Browse Tweets</Link>
              </Button>
            )}
          </div>
        ) : (
          <>
            <Tabs 
              defaultValue="all" 
              value={activeCategory}
              onValueChange={(value) => setActiveCategory(value as TweetCategory | 'all')}
              className="w-full"
            >
              <TabsList className="grid grid-cols-4 mb-4 sm:mb-6">
                {Object.entries(categories).map(([key, category]) => (
                  <TabsTrigger key={key} value={key} className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm py-1 sm:py-2">
                    {category.icon}
                    <span className="hidden sm:inline">{category.label}</span>
                    <Badge variant="outline" className="ml-0 sm:ml-1 text-xs">
                      {key === 'thread' ? 
                        `${category.count} (${threads.reduce((acc, thread) => acc + thread.tweets.length, 0)} tweets)` : 
                        category.count}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={activeCategory} className="mt-0">
                {(activeCategory === 'thread' && displayThreads.length === 0) || 
                 (activeCategory !== 'thread' && displayTweets.length === 0 && 
                  (activeCategory === 'all' ? displayThreads.length === 0 : true)) ? (
                  <div className="text-center py-8 sm:py-12 border border-dashed rounded-lg">
                    <Database className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 text-muted-foreground/60" />
                    <h3 className="text-base sm:text-lg font-medium mb-1">No {activeCategory === 'all' ? 'saved' : activeCategory} tweets</h3>
                    <p className="text-sm sm:text-base text-muted-foreground">
                      {activeCategory === 'thread' 
                        ? `No thread tweets found for ${userParam || 'this user'}.` 
                        : `No ${activeCategory} tweets found in this category.`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Always show threads first, for all categories except when specifically filtering for non-thread tweets */}
                    {(activeCategory === 'all' || activeCategory === 'thread') && displayThreads.length > 0 && (
                      <div className="mb-4">
                        {activeCategory === 'all' && displayThreads.length > 0 && (
                          <h3 className="text-lg font-medium mb-3">Thread Tweets</h3>
                        )}
                        {displayThreads.map(thread => (
                          <div key={thread.id} className="relative group mb-4">
                            <TweetThread 
                              thread={thread} 
                              selectedTweets={new Set()} 
                              onSelectToggle={() => {}} 
                              onSelectThread={() => {}}
                            />
                            <Button
                              className="absolute top-2 right-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                              size="icon"
                              variant="destructive"
                              onClick={() => handleDeleteThread(thread)}
                              disabled={thread.tweets.some(tweet => isDeleting[tweet.id])}
                            >
                              {thread.tweets.some(tweet => isDeleting[tweet.id]) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Display individual tweets if any */}
                    {displayTweets.length > 0 && (
                      <div>
                        {activeCategory === 'all' && displayThreads.length > 0 && (
                          <h3 className="text-lg font-medium mb-3">Individual Tweets</h3>
                        )}
                        {displayTweets.map(tweet => (
                          <div key={tweet.id} className="relative group mb-4">
                            <TweetCard tweet={tweet} onSelectToggle={() => {}} isSelected={false} />
                            <Button
                              className="absolute top-2 right-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                              size="icon"
                              variant="destructive"
                              onClick={() => handleDeleteTweet(tweet.id)}
                              disabled={isDeleting[tweet.id]}
                            >
                              {isDeleting[tweet.id] ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
};

export default SavedTweets; 