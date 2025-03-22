# Tweet Manager Backend

Backend server for Tweet Manager that handles fetching and saving tweets to MongoDB.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/tweet-manager
   NODE_ENV=development
   ```

3. Make sure MongoDB is running on your system or adjust the MongoDB URI in the `.env` file.

## Running the Server

- For development (with nodemon):
  ```
  npm run dev
  ```

- For production:
  ```
  npm start
  ```

## API Endpoints

### Get Tweets
- `GET /api/tweets/user/:username` - Fetch recent tweets (last 50) for a Twitter username

### Saved Tweets
- `GET /api/tweets/saved` - Retrieve all saved tweets from the database
- `GET /api/tweets/saved/users` - Get list of users who have saved tweets
- `GET /api/tweets/saved/user/:username` - Get tweets saved by a specific user
- `POST /api/tweets/save` - Save selected tweets to the database
- `DELETE /api/tweets/:id` - Delete a saved tweet by its ID

## Technologies Used

- Node.js
- Express
- MongoDB
- Mongoose
- Axios for API requests
- dotenv for environment variables
- cors for cross-origin resource sharing

## Integration with Frontend

The frontend application connects to this backend through the API endpoints. Make sure the backend server is running when using the frontend's tweet saving functionality. 