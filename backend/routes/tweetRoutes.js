const express = require('express');
const { 
  getUserTweets, 
  saveTweets, 
  getSavedTweets, 
  deleteTweet,
  getSavedTweetsByUser,
  getSavedUsers,
  deleteTweetsByUser
} = require('../controllers/tweetController');

const router = express.Router();

// Get tweets for a Twitter username
router.get('/user/:username', getUserTweets);

// Get all users who have saved tweets
router.get('/saved/users', getSavedUsers);

// Get all saved tweets
router.get('/saved', getSavedTweets);

// Get saved tweets by specific user
router.get('/saved/user/:username', getSavedTweetsByUser);

// Save selected tweets
router.post('/save', saveTweets);

// Delete a saved tweet
router.delete('/:id', deleteTweet);

// Delete all tweets for a specific user
router.delete('/user/:username', deleteTweetsByUser);

module.exports = router; 