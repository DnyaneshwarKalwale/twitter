import React, { useState, useRef, useEffect } from 'react';
import { Media } from '@/utils/types';

interface MediaDisplayProps {
  media: Media[];
}

const MediaDisplay: React.FC<MediaDisplayProps> = ({ media }) => {
  if (!media || media.length === 0) return null;

  // For multiple images, use a grid layout
  if (media.length > 1) {
    return (
      <div className={`grid gap-2 mt-4 rounded-xl overflow-hidden ${
        media.length === 2 ? 'grid-cols-2' : 
        media.length === 3 ? 'grid-cols-2' : 
        'grid-cols-2'
      }`}>
        {media.map((item, index) => (
          <div 
            key={item.media_key} 
            className={`${
              media.length === 3 && index === 0 ? 'row-span-2' : 
              media.length === 4 && index < 2 ? 'col-span-1' : 
              ''
            } overflow-hidden relative`}
          >
            <SingleMedia media={item} />
          </div>
        ))}
      </div>
    );
  }

  // For a single media item
  return (
    <div className="mt-4 rounded-xl overflow-hidden relative">
      <SingleMedia media={media[0]} />
    </div>
  );
};

interface SingleMediaProps {
  media: Media;
}

const SingleMedia: React.FC<SingleMediaProps> = ({ media }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  
  useEffect(() => {
    // Check if the image is already cached
    if (media.type === 'photo' && mediaRef.current) {
      const img = mediaRef.current as HTMLImageElement;
      if (img.complete) {
        setLoaded(true);
      }
    }
  }, [media.type]);

  const handleLoad = () => {
    setLoaded(true);
  };
  
  const handleError = () => {
    setError(true);
    console.error(`Failed to load media: ${media.url}`);
  };

  // Use a different container class for profile images vs regular media
  const isProfileImage = media.url?.includes('profile_images');
  const containerClass = isProfileImage ? 'profile-media-container' : 'media-container';

  if (media.type === 'video' || media.type === 'animated_gif') {
    return (
      <div className="media-container relative">
        {!loaded && (
          <div className="absolute inset-0 bg-gray-200 animate-pulse flex items-center justify-center">
            <span className="text-sm text-gray-600">Loading video...</span>
          </div>
        )}
        
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={media.url}
          poster={media.preview_image_url}
          controls={media.type === 'video'}
          autoPlay={media.type === 'animated_gif'}
          loop={media.type === 'animated_gif'}
          muted={media.type === 'animated_gif'}
          playsInline
          className="w-full h-auto object-contain"
          onLoadedData={handleLoad}
          onError={handleError}
        />
        
        {error && (
          <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
            <span className="text-sm text-gray-500">Video unavailable</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={containerClass + " relative"}>
      <img
        ref={mediaRef as React.RefObject<HTMLImageElement>}
        src={media.url}
        alt={media.alt_text || "Tweet media"}
        loading="lazy"
        className={`w-full transition-opacity duration-500 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={handleLoad}
        onError={handleError}
      />
      {!loaded && !error && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse-light" />
      )}
      {error && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
          <span className="text-sm text-gray-500">Image unavailable</span>
        </div>
      )}
    </div>
  );
};

export default MediaDisplay;
