import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface TweetFetchSettingsProps {
  onRefresh: () => void;
  isFetching: boolean;
}

const TweetFetchSettings: React.FC<TweetFetchSettingsProps> = ({ 
  onRefresh,
  isFetching
}) => {
  return (
    <div className="flex items-center gap-2">
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
  );
};

export default TweetFetchSettings; 