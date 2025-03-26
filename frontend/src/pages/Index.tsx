import React, { useState, useEffect, useMemo } from 'react';
import Search from '@/components/Search';
import TweetCard from '@/components/TweetCard';
import TweetThread from '@/components/TweetThread';
import TweetCategories from '@/components/TweetCategories';
import TweetPagination from '@/components/TweetPagination';
import TweetFetchSettings from '@/components/TweetFetchSettings';
import { Button } from '@/components/ui/button';
import { fetchUserTweets, groupThreads, saveSelectedTweets } from '@/utils/api';
import { Tweet, Thread, TweetCategory, PaginationState } from '@/utils/types';
import { CheckCircle, Save, Loader2, CheckSquare, X, User, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// Keys for session storage
const SESSION_ITEMS_KEY = 'tweet-train-items';
const SESSION_USER_KEY = 'tweet-train-user';
const SESSION_CATEGORY_KEY = 'tweet-train-category';
const SESSION_PAGE_KEY = 'tweet-train-page';

const Index = () => {
  const [allItems, setAllItems] = useState<(Tweet | Thread)[]>([]);
  const [displayedItems, setDisplayedItems] = useState<(Tweet | Thread)[]>([]);
  const [selectedTweets, setSelectedTweets] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TweetCategory>('all');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveUsername, setSaveUsername] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({
    currentPage: 1,
    totalItems: 0,
    itemsPerPage: 10
  });
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [fetchedTweetCount, setFetchedTweetCount] = useState(0);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Load state from session storage on initial load
  useEffect(() => {
    try {
      const savedItems = sessionStorage.getItem(SESSION_ITEMS_KEY);
      const savedUser = sessionStorage.getItem(SESSION_USER_KEY);
      const savedCategory = sessionStorage.getItem(SESSION_CATEGORY_KEY);
      const savedPage = sessionStorage.getItem(SESSION_PAGE_KEY);
      
      if (savedItems) {
        setAllItems(JSON.parse(savedItems));
      }
      
      if (savedUser) {
        setCurrentUser(savedUser);
      }
      
      if (savedCategory) {
        setSelectedCategory(savedCategory as TweetCategory);
      }
      
      if (savedPage) {
        setPagination(prev => ({
          ...prev,
          currentPage: parseInt(savedPage, 10)
        }));
      }
    } catch (error) {
      console.error('Error loading state from session storage:', error);
    }
  }, []);
  
  // Save state to session storage when it changes
  useEffect(() => {
    if (allItems.length > 0) {
      sessionStorage.setItem(SESSION_ITEMS_KEY, JSON.stringify(allItems));
    }
    
    if (currentUser) {
      sessionStorage.setItem(SESSION_USER_KEY, currentUser);
    }
    
    sessionStorage.setItem(SESSION_CATEGORY_KEY, selectedCategory);
    sessionStorage.setItem(SESSION_PAGE_KEY, pagination.currentPage.toString());
  }, [allItems, currentUser, selectedCategory, pagination.currentPage]);

  // Filter items based on selected category
  const filteredItems = useMemo(() => {
    if (selectedCategory === 'all') {
      return allItems;
    }

    return allItems.filter(item => {
      if (selectedCategory === 'thread' && 'tweets' in item) {
        return true;
      }
      
      if (selectedCategory === 'normal' && !('tweets' in item) && !item.is_long) {
        return true;
      }
      
      if (selectedCategory === 'long' && !('tweets' in item) && item.is_long) {
        return true;
      }
      
      return false;
    });
  }, [allItems, selectedCategory]);

  // Update displayed items when filteredItems or pagination changes
  useEffect(() => {
    // Ensure we have items to display
    if (filteredItems.length === 0) {
      console.log("No filtered items to display");
      setDisplayedItems([]);
      return;
    }
    
    // Calculate start and end indices based on current page
    const startIndex = (pagination.currentPage - 1) * pagination.itemsPerPage;
    const endIndex = startIndex + pagination.itemsPerPage;
    const itemsToDisplay = filteredItems.slice(startIndex, endIndex);
    
    console.log(`Updating displayed items: page ${pagination.currentPage}, showing items ${startIndex}-${endIndex} of ${filteredItems.length}`);
    
    if (itemsToDisplay.length === 0 && filteredItems.length > 0 && pagination.currentPage > 1) {
      // If we're on a page with no items but have filtered items, go back to page 1
      console.log("No items on current page, resetting to page 1");
      setPagination(prev => ({
        ...prev,
        currentPage: 1
      }));
      return;
    }
    
    setDisplayedItems(itemsToDisplay);
    
    // Count how many actual tweets we're displaying
    let displayedTweetCount = 0;
    itemsToDisplay.forEach(item => {
      if ('tweets' in item) {
        displayedTweetCount += item.tweets.length;
      } else {
        displayedTweetCount += 1;
      }
    });
    
    console.log(`Displaying ${itemsToDisplay.length} items on page ${pagination.currentPage} (${displayedTweetCount} tweets)`);
    
    // Log sample of first item for debugging
    if (itemsToDisplay.length > 0) {
      const firstItem = itemsToDisplay[0];
      if ('tweets' in firstItem) {
        console.log("First displayed item is a thread with", firstItem.tweets.length, "tweets");
      } else {
        console.log("First displayed item is a tweet with id", firstItem.id);
      }
    }
    
    setPagination(prev => ({
      ...prev,
      totalItems: filteredItems.length
    }));
  }, [filteredItems, pagination.currentPage, pagination.itemsPerPage]);

  // Reset to first page when category changes
  useEffect(() => {
    setPagination(prev => ({
      ...prev,
      currentPage: 1
    }));
  }, [selectedCategory]);

  // Calculate category counts
  const categoryTweetCounts = useMemo(() => {
    const counts: Record<TweetCategory, number> = {
      all: allItems.length,
      normal: 0,
      thread: 0,
      long: 0
    };

    allItems.forEach(item => {
      if ('tweets' in item) {
        counts.thread++;
      } else {
        if (item.is_long) {
          counts.long++;
        } else {
          counts.normal++;
        }
      }
    });

    return counts;
  }, [allItems]);

  const handleSearch = async (username: string) => {
    setIsLoading(true);
    setAllItems([]);
    setDisplayedItems([]);
    setSelectedTweets(new Set());
    setCurrentUser(username);
    setSelectedCategory('all');
    setFetchedTweetCount(0);
    setPagination({
      currentPage: 1,
      totalItems: 0,
      itemsPerPage: 10
    });
    
    try {
      console.log(`Starting tweet fetch for ${username}...`);
      const tweets = await fetchUserTweets(username);
      console.log(`Received ${tweets.length} tweets from API call`);
      setFetchedTweetCount(tweets.length);
      
      if (tweets.length === 0) {
        toast({
          title: 'No tweets found',
          description: `We couldn't find any tweets for @${username}`,
        });
        setIsLoading(false);
        return;
      }
      
      // Log a sample of tweets to debug
      if (tweets.length > 0) {
        console.log("Sample of first tweet:", {
          id: tweets[0].id,
          text: tweets[0].text?.substring(0, 50) + '...',
          author: tweets[0].author?.username
        });
      }
      
      console.log("Grouping tweets into threads...");
      const groupedItems = groupThreads(tweets);
      console.log(`After grouping, we have ${groupedItems.length} items (threads + individual tweets)`);
      
      // Count actual total tweets
      let totalTweetCount = 0;
      groupedItems.forEach(item => {
        if ('tweets' in item) {
          totalTweetCount += item.tweets.length;
        } else {
          totalTweetCount += 1;
        }
      });
      
      console.log(`Total tweet count across all items: ${totalTweetCount}`);
      
      // Explicitly set the items in state with a timeout to ensure UI updates
      setTimeout(() => {
        setAllItems(groupedItems);
        
        // Ensure first page of items is displayed
        const firstPageItems = groupedItems.slice(0, pagination.itemsPerPage);
        setDisplayedItems(firstPageItems);
        
        // Update pagination with the correct total items
        setPagination(prev => ({
          ...prev,
          currentPage: 1,
          totalItems: groupedItems.length
        }));
        
        console.log(`Set ${firstPageItems.length} items to display`);
        
        toast({
          title: 'Tweets loaded',
          description: `Fetched ${tweets.length} tweets from @${username}`,
        });
        
        setIsLoading(false);
      }, 500);
    } catch (error) {
      console.error('Error fetching tweets:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch tweets. Please try again.',
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    // Update current page
    setPagination(prev => ({
      ...prev,
      currentPage: page
    }));
    
    // Log page change
    console.log(`Changing to page ${page}`);
    
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTweetSelect = (tweet: Tweet) => {
    setSelectedTweets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tweet.id)) {
        newSet.delete(tweet.id);
      } else {
        newSet.add(tweet.id);
      }
      return newSet;
    });
  };

  const handleThreadSelect = (thread: Thread, select: boolean) => {
    setSelectedTweets(prev => {
      const newSet = new Set(prev);
      
      thread.tweets.forEach(tweet => {
        if (select) {
          newSet.add(tweet.id);
        } else {
          newSet.delete(tweet.id);
        }
      });
      
      return newSet;
    });
  };

  const handleSelectAll = () => {
    setSelectedTweets(prev => {
      const newSet = new Set(prev);
      const allSelected = displayedItems.every(item => {
        if ('tweets' in item) {
          return item.tweets.every(tweet => newSet.has(tweet.id));
        } else {
          return newSet.has(item.id);
        }
      });
      
      if (allSelected) {
        displayedItems.forEach(item => {
          if ('tweets' in item) {
            item.tweets.forEach(tweet => newSet.delete(tweet.id));
          } else {
            newSet.delete(item.id);
          }
        });
      } else {
        displayedItems.forEach(item => {
          if ('tweets' in item) {
            item.tweets.forEach(tweet => newSet.add(tweet.id));
          } else {
            newSet.add(item.id);
          }
        });
      }
      
      return newSet;
    });
  };

  const handleClearSelection = () => {
    setSelectedTweets(new Set());
  };

  const handleSaveSelected = () => {
    if (selectedTweets.size === 0) {
      toast({
        title: 'No tweets selected',
        description: 'Please select at least one tweet to save',
      });
      return;
    }
    
    // Open dialog to ask for username
    setSaveDialogOpen(true);
    setSaveUsername(currentUser || '');
  };
  
  const handleConfirmSave = async () => {
    setIsSaving(true);
    setSaveDialogOpen(false);
    
    try {
      const tweetsToSave: Tweet[] = [];
      
      allItems.forEach(item => {
        if ('tweets' in item) {
          item.tweets.forEach(tweet => {
            if (selectedTweets.has(tweet.id)) {
              tweetsToSave.push(tweet);
            }
          });
        } else {
          if (selectedTweets.has(item.id)) {
            tweetsToSave.push(item);
          }
        }
      });
      
      await saveSelectedTweets(tweetsToSave, saveUsername);
      setSelectedTweets(new Set());
      
      toast({
        title: 'Success',
        description: `${tweetsToSave.length} tweets saved successfully.`,
      });
      
      // Navigate directly to the user's saved tweets
      navigate(`/saved/user/${saveUsername}`);
    } catch (error) {
      console.error('Error saving tweets:', error);
      toast({
        title: 'Error',
        description: 'Failed to save selected tweets',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const allSelected = displayedItems.length > 0 && displayedItems.every(item => {
    if ('tweets' in item) {
      return item.tweets.every(tweet => selectedTweets.has(tweet.id));
    } else {
      return selectedTweets.has(item.id);
    }
  });

  // Add function to handle fetching more tweets
  const handleFetchMore = async (count: number) => {
    if (!currentUser) {
      toast({
        title: 'No user selected',
        description: 'Please search for a user first',
        variant: 'destructive',
      });
      return;
    }

    setIsFetchingMore(true);
    
    try {
      console.log(`Fetching ${count} more tweets for ${currentUser}...`);
      
      // Pass specific options to indicate we want to fetch more
      const existingTweets = allItems.flatMap(item => 
        'tweets' in item ? item.tweets : [item]
      );
      
      const additionalTweets = await fetchUserTweets(currentUser, {
        initialFetch: count,
        maxTweets: fetchedTweetCount + count
      });
      
      // Filter out tweets we already have
      const existingIds = new Set(existingTweets.map(t => t.id));
      const newTweets = additionalTweets.filter(tweet => !existingIds.has(tweet.id));
      
      console.log(`Got ${newTweets.length} new tweets out of ${additionalTweets.length} total`);
      
      if (newTweets.length === 0) {
        toast({
          title: 'No new tweets',
          description: 'No additional tweets were found',
        });
        setIsFetchingMore(false);
        return;
      }
      
      // Combine existing and new tweets, then regroup
      const combinedTweets = [...existingTweets, ...newTweets];
      setFetchedTweetCount(combinedTweets.length);
      
      console.log(`Combined ${combinedTweets.length} tweets, regrouping...`);
      const regroupedItems = groupThreads(combinedTweets);
      
      setAllItems(regroupedItems);
      
      toast({
        title: 'Tweets fetched',
        description: `Added ${newTweets.length} new tweets`,
      });
    } catch (error) {
      console.error('Error fetching more tweets:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch more tweets. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsFetchingMore(false);
    }
  };
  
  // Add function to refresh tweets for current user
  const handleRefresh = () => {
    if (currentUser) {
      // Clear session storage to force a fresh fetch
      sessionStorage.removeItem(SESSION_ITEMS_KEY);
      handleSearch(currentUser);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-12">
        <div className="text-center mb-6 sm:mb-10 animate-fade-in">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 sm:mb-3 text-foreground tracking-tight">Tweet Manager</h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto">
            Search for Twitter users, browse their tweets, and save your favorites.
          </p>
        </div>
        
        <Search onSearch={handleSearch} isLoading={isLoading} />
        
        {currentUser && (
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
            <div>
              <h2 className="text-lg font-bold mb-1">
                <User className="inline-block mr-2 h-5 w-5" />
                @{currentUser}
              </h2>
              <div className="text-sm text-muted-foreground">
                Found {fetchedTweetCount} tweets
              </div>
            </div>
            
            <TweetFetchSettings
              onFetchMore={handleFetchMore}
              onRefresh={handleRefresh}
              isFetching={isLoading || isFetchingMore}
            />
          </div>
        )}
        
        {allItems.length > 0 && !isLoading && (
          <TweetCategories 
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            tweetCounts={categoryTweetCounts}
          />
        )}
        
        {/* Debug options for when tweets are loaded but not displaying */}
        {allItems.length > 0 && filteredItems.length > 0 && displayedItems.length === 0 && (
          <div className="flex justify-center my-4">
            <Button 
              variant="outline" 
              size="sm"
              className="text-xs"
              onClick={() => {
                // Force re-render first page
                const firstPageItems = filteredItems.slice(0, pagination.itemsPerPage);
                setDisplayedItems(firstPageItems);
                setPagination(prev => ({
                  ...prev,
                  currentPage: 1
                }));
                console.log(`Manually refreshed display with ${firstPageItems.length} items`);
              }}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh Display
            </Button>
          </div>
        )}
        
        {selectedTweets.size > 0 && (
          <div className="sticky top-4 z-10 bg-white/90 backdrop-blur-sm rounded-xl shadow-md p-3 sm:p-4 mb-4 sm:mb-6 border border-gray-100 animate-scale-in">
            <div className="flex flex-wrap sm:flex-nowrap justify-between items-center">
              <div className="flex items-center gap-2 mb-2 sm:mb-0">
                <div className="text-sm sm:text-base font-medium">
                  {selectedTweets.size} {selectedTweets.size === 1 ? 'tweet' : 'tweets'} selected
                </div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button 
                  onClick={handleSelectAll}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  <CheckSquare className="mr-1 h-4 w-4" />
                  {allSelected ? 'Deselect All' : 'Select All'}
                </Button>
                <Button 
                  onClick={handleClearSelection}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  <X className="mr-1 h-4 w-4" />
                  Clear Selection
                </Button>
                <Button 
                  onClick={handleSaveSelected}
                  disabled={isSaving}
                  className="w-full sm:w-auto"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Selected
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <div className="text-center">
              <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-twitter" />
              <p className="text-muted-foreground">Loading tweets...</p>
            </div>
          </div>
        ) : currentUser && allItems.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-muted-foreground mb-4">No tweets found for @{currentUser}</p>
            
            <Button onClick={() => handleSearch(currentUser)} variant="outline" className="mx-auto">
              Try Again
            </Button>
          </div>
        ) : filteredItems.length === 0 && allItems.length > 0 ? (
          <div className="text-center py-10">
            <p className="text-muted-foreground">No {selectedCategory} tweets found.</p>
            <Button 
              onClick={() => setSelectedCategory('all')} 
              variant="link" 
              className="text-twitter mt-2"
            >
              Show all tweets
            </Button>
          </div>
        ) : displayedItems.length === 0 && filteredItems.length > 0 ? (
          <div className="text-center py-10 border rounded-lg p-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-twitter" />
            <p className="text-muted-foreground mb-2">
              {filteredItems.length} tweets found but none are displaying. This is a technical issue.
            </p>
            <div className="flex justify-center gap-2 mt-4">
              <Button 
                onClick={() => {
                  // Force re-render first page
                  const firstPageItems = filteredItems.slice(0, pagination.itemsPerPage);
                  setDisplayedItems(firstPageItems);
                  console.log(`Manually set ${firstPageItems.length} items to display`);
                }} 
                variant="outline"
              >
                Fix Display
              </Button>
              <Button 
                onClick={() => handleSearch(currentUser)} 
                variant="default"
              >
                Reload Tweets
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <div className="text-sm text-muted-foreground">
                  {filteredItems.length} {selectedCategory !== 'all' ? selectedCategory : ''} items
                </div>
              </div>
              
              <div className="text-sm text-muted-foreground">
                Showing {((pagination.currentPage - 1) * pagination.itemsPerPage) + 1}-
                {Math.min(pagination.currentPage * pagination.itemsPerPage, filteredItems.length)} of {filteredItems.length} items
              </div>
            </div>
            <div className="space-y-6">
              {displayedItems.map(item => (
                'tweets' in item ? (
                  <TweetThread 
                    key={item.id} 
                    thread={item} 
                    selectedTweets={selectedTweets}
                    onSelectToggle={handleTweetSelect}
                    onSelectThread={handleThreadSelect}
                  />
                ) : (
                  <TweetCard 
                    key={item.id} 
                    tweet={item} 
                    isSelected={selectedTweets.has(item.id)}
                    onSelectToggle={handleTweetSelect}
                  />
                )
              ))}
            </div>
            
            {filteredItems.length > pagination.itemsPerPage && (
              <div className="mt-8">
                <TweetPagination 
                  currentPage={pagination.currentPage}
                  totalItems={pagination.totalItems}
                  itemsPerPage={pagination.itemsPerPage}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </>
        )}
        
        {/* Save Username Dialog */}
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Tweets</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="username" className="mb-2 block">
                Enter your username to save these tweets:
              </Label>
              <Input
                id="username"
                value={saveUsername}
                onChange={(e) => setSaveUsername(e.target.value)}
                placeholder="Your username"
                className="mb-4"
              />
              <p className="text-sm text-muted-foreground">
                This will help you find your saved tweets later.
              </p>
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setSaveDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleConfirmSave}
                disabled={!saveUsername.trim()}
              >
                Save Tweets
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Index;
