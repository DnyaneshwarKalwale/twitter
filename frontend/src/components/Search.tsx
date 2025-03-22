import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search as SearchIcon, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SearchProps {
  onSearch: (username: string) => Promise<void>;
  isLoading: boolean;
}

const Search: React.FC<SearchProps> = ({ onSearch, isLoading }) => {
  const [username, setUsername] = useState('');
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a Twitter username',
        variant: 'destructive',
      });
      return;
    }
    
    // Remove @ if user included it
    const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
    
    await onSearch(cleanUsername);
  };

  return (
    <div className="animate-fade-in">
      <div className="p-1 rounded-2xl glass-card border border-gray-100 shadow-sm mb-4 sm:mb-8">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center gap-2 p-2">
          <div className="relative flex-1 w-full">
            <Input
              type="text"
              placeholder="Enter Twitter username..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="pl-10 h-10 sm:h-12 rounded-xl bg-transparent border-0 text-sm sm:text-base focus-visible:ring-1 focus-visible:ring-twitter"
              disabled={isLoading}
            />
            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
          </div>
          <Button 
            type="submit" 
            className="h-10 sm:h-12 px-4 sm:px-6 mt-2 sm:mt-0 w-full sm:w-auto rounded-xl bg-twitter hover:bg-twitter-dark text-white font-medium transition-colors duration-300 relative overflow-hidden"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
            ) : (
              'Fetch Tweets'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Search;
