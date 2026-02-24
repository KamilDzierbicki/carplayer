import YouTubeApiClientInterface from "./youtube-api-client-interface.js";

export default class RapidApiYouTubeClient extends YouTubeApiClientInterface {
  static API_HOST = "yt-api.p.rapidapi.com";
  static API_USAGE_MONTHLY = 300;

  async searchVideos(query, apiKey) {
    const url = `https://${RapidApiYouTubeClient.API_HOST}/search?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.#buildHeaders(apiKey),
    });

    if (!response.ok) {
      if (response.status === 403) throw new Error("Invalid API Key or unauthorized.");
      if (response.status === 429) throw new Error("Rate limit exceeded.");
      throw new Error("HTTP " + response.status);
    }

    const result = await response.json();
    const items = Array.isArray(result?.data) ? result.data : [];

    const videos = items
      .filter((item) => item?.type === "video" && item?.videoId)
      .map((item) => ({
        id: String(item.videoId),
        title: String(item.title || ""),
        durationText: String(item.lengthText || ""),
        thumbnailUrl:
          item?.thumbnail && item.thumbnail.length > 0 && item.thumbnail[0]?.url
            ? String(item.thumbnail[0].url)
            : "",
        channelName: String(item.channelTitle || ""),
        viewCountText: String(item.viewCount || ""),
      }));

    return { videos };
  }

  async getVideoDetails(videoId, apiKey) {
    const response = await fetch(`https://${RapidApiYouTubeClient.API_HOST}/dl?id=${videoId}`, {
      method: "GET",
      headers: this.#buildHeaders(apiKey),
    });

    if (!response.ok) throw new Error("HTTP " + response.status);

    const result = await response.json();
    const rawFormats = Array.isArray(result?.formats) ? result.formats : [];
    const streams = rawFormats
      .filter((format) => format?.url)
      .map((format) => {
        const height = Number(format.height) || 0;
        return {
          url: String(format.url),
          hasAudio: format.hasAudio !== false,
          hasVideo: format.hasVideo !== false,
          height,
          qualityLabel: String(format.qualityLabel || (height ? `${height}p` : "Unknown")),
          itag: Number(format.itag) || 0,
        };
      });

    const fallbackUrl = result?.link ? String(result.link) : result?.url ? String(result.url) : "";

    return {
      id: String(videoId),
      title: String(result?.title || ""),
      streams,
      fallbackUrl,
    };
  }

  #buildHeaders(apiKey) {
    return {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": RapidApiYouTubeClient.API_HOST,
    };
  }
}
