const Tweet = require('../models/Tweet');
const axios = require('axios');

// Configuration for the Twitter API
const RAPID_API_KEY = '4738e035f2mshf219c943077bffap1d4150jsn085da35f2f75';
const RAPID_API_HOST = 'twitter154.p.rapidapi.com';

// Get recent tweets (last 50) for a username
exports.getUserTweets = async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username is required' 
      });
    }

    // First get the user ID
    const userResponse = await axios.get(`https://twitter154.p.rapidapi.com/user/details?username=${username}`, {
      headers: {
        'x-rapidapi-key': RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST,
      },
    });

    const userData = userResponse.data;
    const userId = userData.user_id;

    if (!userId) {
      return res.status(404).json({ 
        success: false, 
        message: `Could not find user ID for @${username}` 
      });
    }

    // Then fetch tweets
    const response = await axios.get(`https://twitter154.p.rapidapi.com/user/tweets?username=${username}&limit=50&includeReplies=false&includeFulltext=true&includeExtendedContent=true&includeQuoted=true&include_entities=true&includeAttachments=true&sort_by=recency&include_video_info=true&includeMedia=true`, {
      headers: {
        'x-rapidapi-key': RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST,
      },
    });

    const tweets = processTweets(response.data);
    
    res.status(200).json({
      success: true,
      count: tweets.length,
      data: tweets
    });
  } catch (error) {
    console.error('Error fetching tweets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tweets',
      error: error.message
    });
  }
};

// Save selected tweets to the database
exports.saveTweets = async (req, res) => {
  try {
    const { tweets, username, options = {} } = req.body;
    
    if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of tweets to save'
      });
    }

    // Log the incoming request
    console.log(`Saving ${tweets.length} tweets for user ${username || 'anonymous'}`);
    console.log('Save options:', options);

    const savedTweets = [];
    const skippedTweets = [];
    const saveUsername = username || 'anonymous';
    
    // Extract options with defaults
    const preserveExisting = options.preserveExisting !== false; // Default to true
    const skipDuplicates = options.skipDuplicates !== false; // Default to true
    const preserveThreadOrder = options.preserveThreadOrder !== false; // Default to true
    
    // Verify all tweets have the essential fields
    const verifiedTweets = tweets.filter(tweet => {
      const hasRequiredFields = tweet && tweet.id && (tweet.text || tweet.full_text) && tweet.created_at;
      if (!hasRequiredFields) {
        console.warn('Skipping tweet with missing required fields:', 
          tweet ? tweet.id : 'undefined tweet');
      }
      return hasRequiredFields;
    });
    
    if (verifiedTweets.length < tweets.length) {
      console.warn(`Filtered out ${tweets.length - verifiedTweets.length} tweets with missing required fields`);
    }
    
    // Group tweets by thread if preserveThreadOrder is true
    let tweetsToProcess = verifiedTweets;
    
    if (preserveThreadOrder) {
      // Organize tweets into thread groups - by thread_id or conversation_id
      const threadGroups = {};
      
      // First pass: group tweets by thread_id or conversation_id
      verifiedTweets.forEach(tweet => {
        const threadId = tweet.thread_id || tweet.conversation_id;
        if (threadId) {
          if (!threadGroups[threadId]) {
            threadGroups[threadId] = [];
          }
          threadGroups[threadId].push(tweet);
        }
      });
      
      // Second pass: sort each thread by thread_position, thread_index, or creation date
      Object.keys(threadGroups).forEach(threadId => {
        threadGroups[threadId].sort((a, b) => {
          // First by thread_position if available
          if (a.thread_position !== undefined && b.thread_position !== undefined) {
            return a.thread_position - b.thread_position;
          }
          
          // Then by thread_index if available
          if (a.thread_index !== undefined && b.thread_index !== undefined) {
            return a.thread_index - b.thread_index;
          }
          
          // Finally by creation date
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        
        // Add or update thread_index to each tweet for proper ordering
        threadGroups[threadId].forEach((tweet, index) => {
          tweet.thread_index = index;
          
          // Ensure consistent thread_id/conversation_id
          tweet.thread_id = tweet.thread_id || threadId;
          tweet.conversation_id = tweet.conversation_id || threadId;
          
          // Mark if this is the root tweet (first in thread)
          if (index === 0) {
            tweet.is_root_tweet = true;
          }
        });
      });
      
      // Create a new tweets array with all tweets in threads in proper order,
      // followed by standalone tweets
      tweetsToProcess = [];
      
      // First add all thread tweets in proper order
      Object.values(threadGroups).forEach(threadTweets => {
        if (threadTweets.length > 0) {
          tweetsToProcess.push(...threadTweets);
        }
      });
      
      // Then add standalone tweets that don't have a thread_id or conversation_id
      verifiedTweets.forEach(tweet => {
        if (!tweet.thread_id && !tweet.conversation_id) {
          tweetsToProcess.push(tweet);
        }
      });
      
      console.log(`Processed ${tweetsToProcess.length} tweets for saving, with thread ordering applied`);
    }
    
    // Save each tweet
    for (const tweet of tweetsToProcess) {
      // Check if tweet already exists
      const existingTweet = await Tweet.findOne({ id: tweet.id });
      
      // Handle duplicate tweets based on options
      if (existingTweet) {
        if (skipDuplicates) {
          // Skip this tweet if it's a duplicate and we're skipping duplicates
          skippedTweets.push(existingTweet);
          console.log(`Skipping duplicate tweet ${tweet.id}`);
          continue;
        } else if (preserveExisting) {
          // If we're preserving existing tweets, update with new metadata
          // while keeping existing content
          const updateFields = { 
            savedAt: new Date(),
            // Thread metadata
            thread_id: tweet.thread_id || existingTweet.thread_id,
            conversation_id: tweet.conversation_id || existingTweet.conversation_id,
            thread_index: tweet.thread_index !== undefined ? tweet.thread_index : existingTweet.thread_index,
            thread_position: tweet.thread_position !== undefined ? tweet.thread_position : existingTweet.thread_position,
            is_root_tweet: tweet.is_root_tweet !== undefined ? tweet.is_root_tweet : existingTweet.is_root_tweet,
            in_reply_to_tweet_id: tweet.in_reply_to_tweet_id || existingTweet.in_reply_to_tweet_id,
            is_self_thread: tweet.is_self_thread !== undefined ? tweet.is_self_thread : existingTweet.is_self_thread
          };
          
          // Update non-thread metadata if available
          if (tweet.author) updateFields.author = tweet.author;
          if (tweet.media_urls) updateFields.media_urls = tweet.media_urls;
          if (tweet.media) updateFields.media = tweet.media;
          
          const updatedTweet = await Tweet.findOneAndUpdate(
            { id: tweet.id },
            updateFields,
            { new: true }
          );
          savedTweets.push(updatedTweet);
          continue;
        }
        // If not preserving or skipping, we'll overwrite below
      }
      
      // Ensure the tweet has a savedBy field and current timestamp
      const tweetToSave = {
        ...tweet,
        savedBy: saveUsername,
        savedAt: new Date()
      };
      
      // Make sure all required thread metadata is present
      if (tweetToSave.thread_id || tweetToSave.conversation_id) {
        tweetToSave.thread_id = tweetToSave.thread_id || tweetToSave.conversation_id;
        tweetToSave.conversation_id = tweetToSave.conversation_id || tweetToSave.thread_id;
      }
      
      const savedTweet = await Tweet.findOneAndUpdate(
        { id: tweet.id },
        tweetToSave,
        { new: true, upsert: true }
      );
      
      savedTweets.push(savedTweet);
    }
    
    console.log(`Successfully saved ${savedTweets.length} tweets, skipped ${skippedTweets.length} duplicates`);
    
    res.status(201).json({
      success: true,
      count: savedTweets.length,
      skippedCount: skippedTweets.length,
      data: savedTweets
    });
  } catch (error) {
    console.error('Error saving tweets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save tweets',
      error: error.message
    });
  }
};

// Get all saved tweets
exports.getSavedTweets = async (req, res) => {
  try {
    // First get all tweets
    const allTweets = await Tweet.find();
    
    // Group by thread_id and maintain order within threads
    const threadMap = new Map();
    const standaloneItems = [];
    
    // First pass: organize tweets into threads
    allTweets.forEach(tweet => {
      if (tweet.thread_id) {
        if (!threadMap.has(tweet.thread_id)) {
          threadMap.set(tweet.thread_id, []);
        }
        threadMap.get(tweet.thread_id).push(tweet);
      } else {
        standaloneItems.push(tweet);
      }
    });
    
    // Second pass: sort tweets within each thread
    const threads = [];
    threadMap.forEach((tweets, threadId) => {
      // Only process threads with more than one tweet
      if (tweets.length > 1) {
        // Sort by thread_index if available, otherwise by created_at
        tweets.sort((a, b) => {
          // If both tweets have thread_index, use that for sorting
          if (a.thread_index !== undefined && b.thread_index !== undefined) {
            return a.thread_index - b.thread_index;
          }
          
          // If both have thread_position, use that
          if (a.thread_position !== undefined && b.thread_position !== undefined) {
            return a.thread_position - b.thread_position;
          }
          
          // Otherwise fall back to created_at date
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        
        // Get the newest tweet in the thread for sorting 
        const newestTweet = [...tweets].sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];
        
        // Add each thread with its sorted tweets
        threads.push({
          id: threadId,
          tweets: tweets,
          savedAt: newestTweet.savedAt,  // Use the newest tweet's savedAt
          created_at: newestTweet.created_at // Use the newest tweet's created_at for sorting
        });
      } else if (tweets.length === 1) {
        // If only one tweet in thread, treat as standalone
        standaloneItems.push(tweets[0]);
      }
    });
    
    // Sort standalone tweets by created_at date (newest first)
    standaloneItems.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA; // Newest first
    });
    
    // Sort threads by their newest tweet's date
    threads.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA; // Newest first
    });
    
    // Combine standalone tweets and threads
    const result = [...standaloneItems, ...threads];
    
    res.status(200).json({
      success: true,
      count: result.length,
      data: result
    });
  } catch (error) {
    console.error('Error getting saved tweets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get saved tweets',
      error: error.message
    });
  }
};

// Delete a saved tweet
exports.deleteTweet = async (req, res) => {
  try {
    const { id } = req.params;
    
    const tweet = await Tweet.findOneAndDelete({ id });
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        message: `Tweet not found with id ${id}`
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Tweet successfully deleted'
    });
  } catch (error) {
    console.error('Error deleting tweet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tweet',
      error: error.message
    });
  }
};

// Get saved tweets by specific user
exports.getSavedTweetsByUser = async (req, res) => {
  try {
    const { username } = req.params;
    
    // First get all tweets saved by this user
    const allTweets = await Tweet.find({ savedBy: username });
    
    // Group by thread_id and maintain order within threads
    const threadMap = new Map();
    const standaloneItems = [];
    
    // First pass: organize tweets into threads
    allTweets.forEach(tweet => {
      if (tweet.thread_id) {
        if (!threadMap.has(tweet.thread_id)) {
          threadMap.set(tweet.thread_id, []);
        }
        threadMap.get(tweet.thread_id).push(tweet);
      } else {
        standaloneItems.push(tweet);
      }
    });
    
    // Second pass: sort tweets within each thread
    const threads = [];
    threadMap.forEach((tweets, threadId) => {
      // Only process threads with more than one tweet
      if (tweets.length > 1) {
        // Sort by thread_index if available, otherwise by created_at
        tweets.sort((a, b) => {
          // If both tweets have thread_index, use that for sorting
          if (a.thread_index !== undefined && b.thread_index !== undefined) {
            return a.thread_index - b.thread_index;
          }
          
          // If both have thread_position, use that
          if (a.thread_position !== undefined && b.thread_position !== undefined) {
            return a.thread_position - b.thread_position;
          }
          
          // Otherwise fall back to created_at date
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        
        // Get the newest tweet in the thread for sorting
        const newestTweet = [...tweets].sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];
        
        // Add each thread with its sorted tweets
        threads.push({
          id: threadId,
          tweets: tweets,
          savedAt: newestTweet.savedAt,  // Use the newest tweet's savedAt
          created_at: newestTweet.created_at // Use the newest tweet's created_at for sorting
        });
      } else if (tweets.length === 1) {
        // If only one tweet in thread, treat as standalone
        standaloneItems.push(tweets[0]);
      }
    });
    
    // Sort standalone tweets by created_at date (newest first)
    standaloneItems.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA; // Newest first
    });
    
    // Sort threads by their newest tweet's date
    threads.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA; // Newest first
    });
    
    // Combine standalone tweets and threads
    const result = [...standaloneItems, ...threads];
    
    res.status(200).json({
      success: true,
      count: result.length,
      data: result
    });
  } catch (error) {
    console.error('Error getting saved tweets for user:', error);
    res.status(500).json({
      success: false,
      message: `Failed to get saved tweets for user ${req.params.username}`,
      error: error.message
    });
  }
};

// Get all unique usernames who have saved tweets
exports.getSavedUsers = async (req, res) => {
  try {
    // Find distinct savedBy values
    const users = await Tweet.distinct('savedBy');
    
    // Count tweets for each user
    const userCounts = await Promise.all(
      users.map(async (username) => {
        const count = await Tweet.countDocuments({ savedBy: username });
        return {
          username,
          tweetCount: count,
          lastSaved: await Tweet.findOne({ savedBy: username })
            .sort({ savedAt: -1 })
            .select('savedAt author.profile_image_url')
        };
      })
    );
    
    res.status(200).json({
      success: true,
      count: userCounts.length,
      data: userCounts
    });
  } catch (error) {
    console.error('Error getting saved users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get saved users',
      error: error.message
    });
  }
};

// Delete all tweets for a specific user
exports.deleteTweetsByUser = async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }
    
    // Find and count tweets before deletion for response
    const tweetCount = await Tweet.countDocuments({ savedBy: username });
    
    if (tweetCount === 0) {
      return res.status(404).json({
        success: false,
        message: `No tweets found for user ${username}`
      });
    }
    
    // Delete all tweets for this user
    const result = await Tweet.deleteMany({ savedBy: username });
    
    res.status(200).json({
      success: true,
      message: `Successfully deleted ${tweetCount} tweets for user ${username}`,
      deletedCount: tweetCount
    });
  } catch (error) {
    console.error('Error deleting tweets by user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tweets',
      error: error.message
    });
  }
};

// Helper function to process tweets from the Twitter API
const processTweets = (response) => {
  if (!response || !response.results) {
    return [];
  }

  return response.results.map(tweet => {
    // Check if it's a long tweet (more than 280 characters)
    const isLong = tweet.text && tweet.text.length > 280;
    
    // Create a standardized tweet object that matches our schema
    return {
      id: tweet.tweet_id,
      text: tweet.text || '',
      full_text: tweet.text || '',
      created_at: tweet.creation_date,
      public_metrics: {
        retweet_count: tweet.retweet_count || 0,
        reply_count: tweet.reply_count || 0,
        like_count: tweet.favorite_count || 0,
        quote_count: tweet.quote_count || 0
      },
      author: {
        id: tweet.user.user_id,
        name: tweet.user.name,
        username: tweet.user.username,
        profile_image_url: tweet.user.profile_pic_url
      },
      conversation_id: tweet.conversation_id || tweet.tweet_id,
      media: processMedia(tweet),
      is_long: isLong,
      category: isLong ? 'long' : 'normal'
    };
  });
};

// Helper function to process media attachments
const processMedia = (tweet) => {
  const media = [];
  
  if (tweet.media_urls && tweet.media_urls.length > 0) {
    tweet.media_urls.forEach((url, index) => {
      media.push({
        media_key: `${tweet.tweet_id}_media_${index}`,
        type: 'photo',
        url,
      });
    });
  }
  
  if (tweet.video_url) {
    media.push({
      media_key: `${tweet.tweet_id}_video`,
      type: 'video',
      url: tweet.video_url,
      preview_image_url: tweet.thumbnail_url
    });
  }
  
  return media;
}; 