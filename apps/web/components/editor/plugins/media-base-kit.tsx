import { BaseCaptionPlugin } from "@platejs/caption"
import {
  BaseAudioPlugin,
  BaseFilePlugin,
  BaseImagePlugin,
  BaseMediaEmbedPlugin,
  BasePlaceholderPlugin,
  BaseVideoPlugin,
} from "@platejs/media"
import { KEYS } from "platejs"

import { AudioElementStatic } from "@workspace/ui/components/media-audio-node-static"
import { FileElementStatic } from "@workspace/ui/components/media-file-node-static"
import { ImageElementStatic } from "@workspace/ui/components/media-image-node-static"
import { VideoElementStatic } from "@workspace/ui/components/media-video-node-static"

export const BaseMediaKit = [
  BaseImagePlugin.withComponent(ImageElementStatic),
  BaseVideoPlugin.withComponent(VideoElementStatic),
  BaseAudioPlugin.withComponent(AudioElementStatic),
  BaseFilePlugin.withComponent(FileElementStatic),
  BaseCaptionPlugin.configure({
    options: {
      query: {
        allow: [KEYS.img, KEYS.video, KEYS.audio, KEYS.file, KEYS.mediaEmbed],
      },
    },
  }),
  BaseMediaEmbedPlugin,
  BasePlaceholderPlugin,
]
