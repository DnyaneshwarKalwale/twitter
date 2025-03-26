export interface Tweet {
  id: string;
  author: User;
  text: string;
  extended_text?: string;
  full_text?: string;
  created_at: string;
  entities?: {
    media?: Media[];
    mentions?: Mention[];
    hashtags?: Hashtag[];
    urls?: Url[];
  };
  quoted_tweet?: Tweet;
  media?: Media[];
  quoted_status?: Tweet;
  in_reply_to_status_id?: string;
  in_reply_to_user_id?: string;
  in_reply_to_screen_name?: string;
  in_reply_to_tweet_id?: string;
  is_quoted?: boolean;
  is_retweet?: boolean;
  is_reply?: boolean;
  reply_count?: number;
  retweet_count?: number;
  favorite_count?: number;
  quote_count?: number;
  conversation_id?: string;
  thread_id?: string;
  thread_position?: number; // Position in thread based on creation time
  thread_index?: number;    // Position in thread for display ordering
  is_long?: boolean;
  has_media?: boolean;
  savedAt?: Date | string;
  savedBy?: string;
  referenced_tweets?: {
    type: string;
    id: string;
    text: string;
    author?: {
      name: string;
      username: string;
      profile_image_url: string;
    };
    media?: Media[];
  }[];
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
  savedAt?: Date | string;
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
