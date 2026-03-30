# Transcribe

Drop an audio or video file, get the transcript. That's it.

---

## Setup (Mac)

Open **Terminal** (press `Cmd + Space`, type "Terminal", hit Enter) and run these commands one at a time:

### 1. Install Bun (the runtime)

```sh
curl -fsSL https://bun.sh/install | bash
```

Close and reopen Terminal after this finishes.

### 2. Install ffmpeg (handles large/mov files)

```sh
brew install ffmpeg
```

If you get "brew: command not found", install Homebrew first:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then run the `brew install ffmpeg` command again.

### 3. Download this project

```sh
cd ~/Desktop
git clone https://github.com/Joshbly/Transcription.git
cd Transcription
```

### 4. Add your OpenAI API key

```sh
echo "OPENAI_API_KEY=your-key-here" > .env
```

Replace `your-key-here` with your actual key from https://platform.openai.com/api-keys

### 5. Install packages

```sh
bun install
```

### 6. Start the app

```sh
bun start
```

You should see:

```
Started development server: http://localhost:3000
```

### 7. Open the app

Go to http://localhost:3000 in your browser. Drag a file onto the page.

---

## Supported files

| Format | Max size | Notes |
|--------|----------|-------|
| .mp4   | 2 GB     | Most common |
| .m4a   | 2 GB     | Audio only |
| .mov   | 2 GB     | Auto-converted to mp4 |
| .mp3   | 2 GB     | Works directly |
| .wav   | 2 GB     | Works directly |
| .webm  | 2 GB     | Works directly |

Files over 25 MB are automatically compressed before transcription. You don't need to do anything.

---

## Stopping and restarting

- To stop: press `Ctrl + C` in Terminal
- To start again: `cd ~/Desktop/Transcription && bun start`

---

## Troubleshooting

If something goes wrong, paste the error message into Claude or ChatGPT along with one of these prompts:

**App won't start:**

> I'm trying to run a Bun + Hono web app on my Mac. When I run `bun start` I get this error: [paste error]. The app is a transcription tool that sends audio to OpenAI's API. Help me fix this.

**File upload fails:**

> I'm uploading a [size] [format] file to a local transcription app. The server uses ffmpeg to compress files over 25MB, then sends them to OpenAI's gpt-4o-transcribe API. I'm getting this error: [paste error]. How do I fix it?

**ffmpeg issues:**

> I installed ffmpeg via `brew install ffmpeg` on Mac but I'm getting this error when trying to convert a .mov file: [paste error]. I need ffmpeg to work with Bun.spawn(). What's wrong?

**OpenAI API errors:**

> I'm calling OpenAI's audio transcriptions endpoint with model "gpt-4o-transcribe" and response_format "text". I'm getting this error: [paste error]. My file is [size] and format [format]. What's the issue?

**"command not found" errors:**

> I'm on Mac and getting "command not found" when I run `bun` (or `brew` or `ffmpeg`). I installed it with [how you installed it]. How do I fix my PATH?
