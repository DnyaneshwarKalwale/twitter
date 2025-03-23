import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Database, User, Calendar, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

const BACKEND_API_URL = 'https://twitter-aee7.onrender.com/api/tweets';

interface SavedUser {
  username: string;
  tweetCount: number;
  lastSaved: {
    savedAt: string;
    author: {
      profile_image_url: string;
    };
  };
}

const SavedUsersList: React.FC = () => {
  const [users, setUsers] = useState<SavedUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  useEffect(() => {
    fetchSavedUsers();
  }, []);

  const fetchSavedUsers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${BACKEND_API_URL}/saved/users`);
      
      if (!response.ok) {
        throw new Error(`Error fetching saved users: ${response.status}`);
      }
      
      const data = await response.json();
      setUsers(data.data);
    } catch (error) {
      console.error('Error fetching saved users:', error);
      toast({
        title: 'Error',
        description: 'Failed to load saved users',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDeleteUserTweets = async (username: string) => {
    setIsDeleting(prev => ({ ...prev, [username]: true }));
    try {
      const response = await fetch(`${BACKEND_API_URL}/user/${username}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`Error deleting tweets: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Remove the user from the state
      setUsers(prev => prev.filter(user => user.username !== username));
      
      toast({
        title: 'Success',
        description: `Deleted ${data.deletedCount} tweets for @${username}`,
      });
    } catch (error) {
      console.error('Error deleting user tweets:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete tweets',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(prev => ({ ...prev, [username]: false }));
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="mb-4 sm:mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">Saved Tweets by User</h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          View all tweets saved by each user
        </p>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <Database className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Saved Tweets by Users</h2>
          <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-medium">
            {users.length} users
          </span>
        </div>
        
        <Button
          onClick={fetchSavedUsers}
          variant="outline"
          size="sm"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            'Refresh'
          )}
        </Button>
      </div>
      
      {isLoading ? (
        <div className="flex justify-center items-center py-10 sm:py-20">
          <div className="text-center">
            <Loader2 className="h-8 w-8 sm:h-10 sm:w-10 animate-spin mx-auto mb-3 sm:mb-4 text-twitter" />
            <p className="text-sm sm:text-base text-muted-foreground">Loading saved users...</p>
          </div>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-8 sm:py-12 border border-dashed rounded-lg">
          <Database className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 text-muted-foreground/60" />
          <h3 className="text-base sm:text-lg font-medium mb-1">No saved tweets</h3>
          <p className="text-sm sm:text-base text-muted-foreground px-4">
            Saved tweets will appear here. Go to search and select tweets to save.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {users.map(user => (
            <div key={user.username} className="relative group">
              <Link
                to={`/saved/user/${user.username}`}
                className="block"
              >
                <div className="bg-card hover:bg-accent/50 transition-colors p-3 sm:p-4 rounded-lg border shadow-sm hover:shadow-md">
                  <div className="flex items-center gap-3">
                    {user.lastSaved?.author?.profile_image_url ? (
                      <img 
                        src={user.lastSaved.author.profile_image_url} 
                        alt={user.username}
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                      </div>
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-base sm:text-lg text-foreground truncate">@{user.username}</h3>
                      <div className="flex flex-col sm:flex-row sm:items-center text-xs sm:text-sm text-muted-foreground">
                        <span className="mr-0 sm:mr-3">{user.tweetCount} tweets</span>
                        {user.lastSaved?.savedAt && (
                          <div className="flex items-center mt-1 sm:mt-0">
                            <Calendar className="h-3 w-3 mr-1" />
                            <span className="truncate">Last saved {formatDistanceToNow(new Date(user.lastSaved.savedAt))} ago</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
              
              {/* Delete Button with Confirmation Dialog */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    className="absolute top-2 right-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    size="icon"
                    variant="destructive"
                    disabled={isDeleting[user.username]}
                  >
                    {isDeleting[user.username] ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete all tweets for @{user.username}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all {user.tweetCount} tweets saved for this user.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => handleDeleteUserTweets(user.username)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SavedUsersList; 