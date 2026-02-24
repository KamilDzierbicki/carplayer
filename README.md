# <img src="icons/favicon.svg" alt="CarPlayer logo" height="48" style="vertical-align: middle;"> CarPlayer

A simple web video player that lets passengers, especially kids, watch videos while driving by bypassing standard in-car
entertainment restrictions.

> Disclaimer: Use responsibly. This project is intended for passengers only. The driver must stay focused on the road at
> all times.

## How to use in the car

1. Open your car browser.
2. Go to: [https://kamildzierbicki.github.io/carplayer/](https://kamildzierbicki.github.io/carplayer/)
3. Click **Add Video**.
4. Scan the QR code with your phone / You can also type a direct `.mp4` link manually
5. Paste a video link on your phone and tap **Send to Car**.
6. The video opens in your car browser.

## Functions

- Play MP4 video from direct links.
- Play YouTube videos.
- Search YouTube directly in the app.
- Share links from your mobile phone to the car without typing long URLs.
- Save recent watch history.
- Control playback speed.
- Resume videos from the last watched timestamp.
- Save volume and playback speed between sessions.
- Provide fullscreen playback with a dark, easy-to-read UI.
- All data is stored locally in your browser (no backend required)

## Limitations

- **Easy video link sharing**: Works with any car app that supports sending web links from your smartphone to the
  vehicle's browser. (If not - you can still type link manually).
- **Format Support**: Only standard MP4 containers are supported (limited by your browser). Specialized or proprietary
  codecs may not be compatible (often video will play but without sound becuase of codecs).
- **YouTube Videos**: Playback is limited to 360p or 720p. This is due to the browser requiring a single multiplexed
  file (combined audio and video), whereas higher resolutions often use separate streams.
- **API Requirements**: API key from RapidAPI is required for YouTube functionality. We welcome Pull Requests to support
  alternative providers, such as the Invidious API if you have any idea on how to solve CORS/proxy issues.

## Screenshots

<img src="demo3.png" alt="CarPlayer screen" width="800">
<img src="demo2.png" alt="CarPlayer screen" width="800">
<img src="demo.png" alt="CarPlayer screen" width="800">

## Development

We use vanilla HTML, CSS and JS files - we don't need any bundler or compiler.

### Installation

```bash
git clone git@github.com:KamilDzierbicki/carplayer.git
cd carplayer
```

### Run locally

Option 1: Python

```bash
python3 -m http.server 8080
```

Option 2: Node.js (no install)

```bash
npx serve -l 8080 .
```

Option 3: Docker + nginx

```bash
docker run --rm -it -p 8080:80 -v "$PWD":/usr/share/nginx/html:ro nginx:alpine
```

After that, open: `http://localhost:8080/index.html`

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch:`git checkout -b feature/my-change`
3. Make focused changes in small commits.
4. Run manual checks locally.
5. Open a Pull Request with:
    - what changed,
    - why it changed,
    - how it was tested (steps/screenshots/GIF if UI impact).

## License

This project is licensed under the MIT License.
