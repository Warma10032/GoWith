export interface MockVideo {
  bvid: string;
  title: string;
  description: string;
  cover_url: string;
  source_url: string;
  duration_sec: number;
  published_at: string;
  tags: string[];
  category: string;
  stats: Record<string, number>;
  transcript: Array<{ start_sec: number; end_sec: number; text: string }>;
  comments: Array<{ id: string; content: string; sample_type: "hot" | "latest" | "keyword"; like_count: number }>;
}

export interface MockCreatorPayload {
  uid: string;
  name: string;
  avatar_url: string;
  bio: string;
  follower_count: number;
  videos: MockVideo[];
}

const creatorNames: Record<string, string> = {
  "3546888255048212": "探店样本 A",
  "99157282": "探店样本 B",
  "1781681364": "探店样本 C",
  "544336675": "探店样本 D",
  "8263502": "探店样本 E",
};

export async function fetchCreatorVideos(uid: string): Promise<MockCreatorPayload> {
  const name = creatorNames[uid] ?? `B站 UID ${uid}`;
  const safeUid = uid.slice(-6);
  return {
    uid,
    name,
    avatar_url: `https://i0.hdslb.com/bfs/face/${safeUid}.jpg`,
    bio: "GoWith MVP mock creator payload",
    follower_count: 100000 + Number(safeUid.replace(/\D/g, "").slice(0, 3) || 1),
    videos: [
      {
        bvid: `BV${safeUid}001`,
        title: `${name}在上海找到一家牛肉面小店`,
        description: "本期探店上海南京东路附近的面馆，主打牛肉面和卤味。",
        cover_url: "https://dummyimage.com/640x360/f8f1e7/2d2118&text=GoWith+Shop",
        source_url: `https://www.bilibili.com/video/BV${safeUid}001`,
        duration_sec: 520,
        published_at: "2026-05-01T12:00:00Z",
        tags: ["探店", "上海", "牛肉面"],
        category: "美食",
        stats: { view: 120000, like: 6800, favorite: 2100, reply: 840 },
        transcript: [
          { start_sec: 18, end_sec: 32, text: "今天来到上海南京东路附近，这家某某牛肉面开了很多年。" },
          { start_sec: 140, end_sec: 154, text: "牛肉面大概三十元左右，牛肉给得比较多，汤底也很浓。" },
          { start_sec: 320, end_sec: 338, text: "缺点是中午排队会比较久，建议错峰来。" },
        ],
        comments: [
          { id: `c_${safeUid}_1`, content: "这家是不是南京东路那家某某牛肉面？", sample_type: "keyword", like_count: 88 },
          { id: `c_${safeUid}_2`, content: "排队真的久，但分量还可以。", sample_type: "hot", like_count: 141 },
          { id: `c_${safeUid}_3`, content: "最近还开着，晚上人少一点。", sample_type: "latest", like_count: 13 },
        ],
      },
      {
        bvid: `BV${safeUid}002`,
        title: `${name}的周末城市散步`,
        description: "城市散步和聊天，非线下店铺探店。",
        cover_url: "https://dummyimage.com/640x360/e8edf4/263241&text=GoWith+Vlog",
        source_url: `https://www.bilibili.com/video/BV${safeUid}002`,
        duration_sec: 410,
        published_at: "2026-05-11T12:00:00Z",
        tags: ["vlog", "散步"],
        category: "生活",
        stats: { view: 56000, like: 2300, favorite: 400, reply: 120 },
        transcript: [
          { start_sec: 22, end_sec: 36, text: "今天只是出来散步，聊一下最近的生活。" },
          { start_sec: 100, end_sec: 120, text: "这期没有探店，主要是随便看看城市。" },
        ],
        comments: [
          { id: `c_${safeUid}_4`, content: "散步也挺舒服。", sample_type: "hot", like_count: 21 },
        ],
      },
    ],
  };
}

