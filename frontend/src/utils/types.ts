export interface Tweet {
  id: string;
  text: string;
  full_text?: string;
  created_at: string;
  public_metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  author: {
    id: string;
    name: string;
    username: string;
    profile_image_url: string;
  };
  attachments?: {
    media_keys: string[];
  };
  referenced_tweets?: {
    type: 'replied_to' | 'retweeted' | 'quoted';
    id: string;
    text?: string;
    author?: {
      name?: string;
      username?: string;
      profile_image_url?: string;
    };
    media?: Media[];
  }[];
  conversation_id: string;
  in_reply_to_user_id?: string;
  media?: Media[];
  thread_id?: string;
  is_long?: boolean;
  category?: TweetCategory;
  savedBy?: string;
  savedAt?: string;
}

export interface Media {
  media_key: string;
  type: 'photo' | 'video' | 'animated_gif';
  url: string;
  preview_image_url?: string;
  alt_text?: string;
  duration_ms?: number;
  width?: number;
  height?: number;
}

export interface Thread {
  id: string;
  tweets: Tweet[];
  author?: {
    id: string;
    name: string;
    username: string;
    profile_image_url: string;
  };
  created_at?: string;
  isSelected?: boolean;
}

export interface TwitterUser {
  id: string;
  name: string;
  username: string;
  profile_image_url: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
}

export interface TwitterResponse {
  data: Tweet[];
  includes?: {
    media?: Media[];
    users?: TwitterUser[];
    tweets?: Tweet[];
  };
  meta: {
    result_count: number;
    next_token?: string;
  };
}

export type TweetCategory = 'all' | 'normal' | 'thread' | 'long';

export interface CategoryOption {
  value: TweetCategory;
  label: string;
  icon?: React.ReactNode;
}

export interface PaginationState {
  currentPage: number;
  totalItems: number;
  itemsPerPage: number;
}
