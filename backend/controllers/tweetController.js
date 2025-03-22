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
    const { tweets, username } = req.body;
    
    if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of tweets to save'
      });
    }

    const savedTweets = [];
    const saveUsername = username || 'anonymous';
    
    // Save each tweet, using upsert to avoid duplicates
    for (const tweet of tweets) {
      const tweetToSave = {
        ...tweet,
        savedBy: saveUsername,
        savedAt: new Date()
      };
      
      const savedTweet = await Tweet.findOneAndUpdate(
        { id: tweet.id },
        tweetToSave,
        { new: true, upsert: true }
      );
      savedTweets.push(savedTweet);
    }
    
    res.status(201).json({
      success: true,
      count: savedTweets.length,
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
    const tweets = await Tweet.find().sort({ created_at: -1 });
    
    res.status(200).json({
      success: true,
      count: tweets.length,
      data: tweets
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

// Get saved tweets by username
exports.getSavedTweetsByUser = async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }
    
    const tweets = await Tweet.find({ savedBy: username }).sort({ savedAt: -1 });
    
    res.status(200).json({
      success: true,
      count: tweets.length,
      data: tweets
    });
  } catch (error) {
    console.error('Error getting saved tweets by user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get saved tweets',
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