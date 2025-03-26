import React, { useState, useEffect } from 'react';
import { TwitterConfig } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose
} from '@/components/ui/sheet';
import { Settings, RefreshCw } from 'lucide-react';

interface TweetFetchSettingsProps {
  onFetchMore: (count: number) => void;
  onRefresh: () => void;
  isFetching: boolean;
}

const TweetFetchSettings: React.FC<TweetFetchSettingsProps> = ({ 
  onFetchMore, 
  onRefresh,
  isFetching
}) => {
  const [initialFetch, setInitialFetch] = useState(TwitterConfig.fetchLimit);
  const [maxTweets, setMaxTweets] = useState(TwitterConfig.maxTweets);
  const [fetchMoreCount, setFetchMoreCount] = useState(20);
  
  // Update component state if TwitterConfig changes elsewhere
  useEffect(() => {
    setInitialFetch(TwitterConfig.fetchLimit);
    setMaxTweets(TwitterConfig.maxTweets);
  }, []);
  
  const handleSaveSettings = () => {
    TwitterConfig.setFetchLimit(initialFetch);
    TwitterConfig.setMaxTweets(maxTweets);
  };
  
  const handleFetchMore = () => {
    if (fetchMoreCount > 0) {
      onFetchMore(fetchMoreCount);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Tweet Fetch Settings</SheetTitle>
            <SheetDescription>
              Configure how many tweets to fetch and display
            </SheetDescription>
          </SheetHeader>
          
          <div className="py-4 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="initialFetch">Initial Fetch Count: {initialFetch}</Label>
              <div className="flex items-center gap-2">
                <Slider
                  id="initialFetch"
                  min={10}
                  max={100}
                  step={10}
                  value={[initialFetch]}
                  onValueChange={(vals) => setInitialFetch(vals[0])}
                />
                <span className="w-10 text-center">{initialFetch}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Number of tweets to fetch on initial load
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="maxTweets">Maximum Tweets: {maxTweets}</Label>
              <div className="flex items-center gap-2">
                <Slider
                  id="maxTweets"
                  min={50}
                  max={300}
                  step={50}
                  value={[maxTweets]}
                  onValueChange={(vals) => setMaxTweets(vals[0])}
                />
                <span className="w-10 text-center">{maxTweets}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum number of tweets to fetch in total
              </p>
            </div>
          </div>
          
          <SheetFooter>
            <SheetClose asChild>
              <Button onClick={handleSaveSettings}>Save Settings</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="5"
          max="50"
          value={fetchMoreCount}
          onChange={(e) => setFetchMoreCount(parseInt(e.target.value) || 20)}
          className="w-20 h-9"
        />
        <Button 
          size="sm" 
          onClick={handleFetchMore}
          disabled={isFetching}
        >
          {isFetching ? 'Loading...' : 'Fetch More'}
        </Button>
        
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={isFetching}
          title="Refresh Tweets"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </div>
  );
};

export default TweetFetchSettings; 