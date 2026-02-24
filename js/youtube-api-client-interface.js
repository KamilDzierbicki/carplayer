export default class YouTubeApiClientInterface {
  static API_USAGE_MONTHLY = 0;

  getApiUsageMonthlyLimit() {
    return this.constructor.API_USAGE_MONTHLY || 0;
  }

  // Returns: { videos: [{ id, title, durationText, thumbnailUrl, channelName, viewCountText }] }
  async searchVideos(_query, _apiKey) {
    throw new Error("searchVideos() must be implemented by API client.");
  }

  // Returns: { id, title, streams: [{ url, hasAudio, hasVideo, height, qualityLabel, itag }], fallbackUrl }
  async getVideoDetails(_videoId, _apiKey) {
    throw new Error("getVideoDetails() must be implemented by API client.");
  }
}
