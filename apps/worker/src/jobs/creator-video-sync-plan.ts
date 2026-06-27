export interface ListedCreatorVideo {
  bvid: string;
}

export interface ExistingCreatorVideo {
  id: string;
  bvid: string;
  workflow_status: string;
  deleted_at?: Date | string | null;
}

export type CreatorVideoSyncAction<
  TVideo extends ListedCreatorVideo = ListedCreatorVideo,
> =
  | {
      kind: "new";
      video: TVideo;
    }
  | {
      kind: "retry_failed";
      video: TVideo;
      existing: ExistingCreatorVideo;
    }
  | {
      kind: "skip_existing";
      video: TVideo;
      existing: ExistingCreatorVideo;
    };

export function planCreatorVideoSync<TVideo extends ListedCreatorVideo>(
  listedVideos: TVideo[],
  existingVideos: ExistingCreatorVideo[],
): CreatorVideoSyncAction<TVideo>[] {
  const existingByBvid = new Map(
    existingVideos.map((video) => [video.bvid, video]),
  );
  const seen = new Set<string>();
  const actions: CreatorVideoSyncAction<TVideo>[] = [];

  for (const video of listedVideos) {
    if (seen.has(video.bvid)) continue;
    seen.add(video.bvid);

    const existing = existingByBvid.get(video.bvid);
    if (!existing) {
      actions.push({ kind: "new", video });
      continue;
    }

    if (
      !existing.deleted_at &&
      existing.workflow_status === "metadata_failed"
    ) {
      actions.push({ kind: "retry_failed", video, existing });
      continue;
    }

    actions.push({ kind: "skip_existing", video, existing });
  }

  return actions;
}
