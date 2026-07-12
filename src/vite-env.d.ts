/// <reference types="vite/client" />

interface CodyFileTrack {
  artworkUrl?: string;
  bitrate?: number;
  codec?: string;
  duration?: number;
  id: string;
  title: string;
  artist: string;
  album: string;
  filePath?: string;
  fileName: string;
  genre?: string;
  metadataSource?: string;
  sampleRate?: number;
  size: number;
  takeoutMatchConfidence?: number;
  takeoutSourceFile?: string;
  url: string;
  youtubeMusicUrl?: string;
  youtubeVideoId?: string;
  year?: number;
}

interface CodyTakeoutCsv {
  fileName: string;
  text: string;
}

interface Window {
  musicHost?: {
    getPathForFile: (file: File) => string;
    importAudioPaths: (filePaths: string[]) => Promise<CodyFileTrack[]>;
    loadDefaultLibrary: () => Promise<CodyFileTrack[]>;
    onMenuCommand: (
      callback: (
        command:
          | "import-audio-files"
          | "import-audio-folder"
          | "import-takeout-csv"
          | "next-track"
          | "previous-track"
          | "reset-local-library"
          | "toggle-playback"
      ) => void
    ) => () => void;
    pickAudioFiles: () => Promise<CodyFileTrack[]>;
    pickAudioFolder: () => Promise<CodyFileTrack[]>;
    pickTakeoutCsv: () => Promise<CodyTakeoutCsv[]>;
    readTakeoutCsvPaths: (filePaths: string[]) => Promise<CodyTakeoutCsv[]>;
    setPlaybackActive: (active: boolean) => Promise<boolean>;
  };
}
