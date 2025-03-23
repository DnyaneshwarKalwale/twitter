# Tweet Manager

A web application that allows users to fetch, browse, and save tweets from Twitter.

## Features

- Fetch tweets from Twitter users
- Organize tweets by categories (Normal, Thread, Long)
- Save favorite tweets to a database
- Pagination for easier browsing
- Responsive design for all devices

## Technologies Used

- React with TypeScript
- Vite for fast development
- TailwindCSS for styling
- Shadcn UI components
- React Router for navigation

## Development

To run the project locally:

```sh
# Install dependencies
npm install

# Start the development server
npm run dev
```

## Deployment

This project is configured for deployment on Netlify. The configuration includes:

- SPA routing support
- 404 page redirects
- Automatic build processes

## Project Structure

- `/src`: Main source code
  - `/components`: Reusable UI components
  - `/pages`: Page components
  - `/utils`: Utility functions and types
  - `/hooks`: Custom React hooks
- `/public`: Static assets
