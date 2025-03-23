import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TweetCategory, CategoryOption } from '@/utils/types';
import { MessagesSquare, Layers, Text, ListFilter } from 'lucide-react';

interface TweetCategoriesProps {
  selectedCategory: TweetCategory;
  onCategoryChange: (category: TweetCategory) => void;
  tweetCounts?: Record<TweetCategory, number>;
  categoryCounts?: Record<TweetCategory, number>; // Support both prop names
}

const TweetCategories: React.FC<TweetCategoriesProps> = ({ 
  selectedCategory, 
  onCategoryChange,
  tweetCounts = {},
  categoryCounts = {}
}) => {
  // Use either tweetCounts or categoryCounts, with a fallback to an empty object
  const counts = Object.keys(tweetCounts).length > 0 ? tweetCounts : categoryCounts;
  
  const categories: CategoryOption[] = [
    { value: 'all', label: 'All Tweets', icon: <ListFilter className="h-4 w-4" /> },
    { value: 'normal', label: 'Regular', icon: <Text className="h-4 w-4" /> },
    { value: 'thread', label: 'Threads', icon: <Layers className="h-4 w-4" /> },
    { value: 'long', label: 'Long', icon: <MessagesSquare className="h-4 w-4" /> },
  ];

  return (
    <div className="mb-4 sm:mb-6">
      <Tabs value={selectedCategory} onValueChange={(value) => onCategoryChange(value as TweetCategory)}>
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap px-1 bg-white/50 backdrop-blur-sm">
          {categories.map((category) => (
            <TabsTrigger 
              key={category.value} 
              value={category.value}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 whitespace-nowrap text-xs sm:text-sm"
            >
              {category.icon}
              <span>{category.label}</span>
              <span className="ml-1 rounded-full bg-muted px-1 sm:px-2 py-0.5 text-xs">
                {counts && counts[category.value] ? counts[category.value] : 0}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
};

export default TweetCategories;
