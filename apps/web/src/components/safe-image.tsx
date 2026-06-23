/**
 * SafeImage：项目里所有第三方 / 跨域图片统一走这个组件。
 *
 * 历史教训：B 站 hdslb.com CDN 默认 Referer 白名单只接受自家域名，
 * 浏览器 `<img>` 默认会带 `Referer: http://localhost:13000/...`，
 * 被 B 站 403。这里显式 `referrerPolicy="no-referrer"` 绕过。
 *
 * 现在 avatar_url / cover_url 都已切到自家 /uploads/... 域名，
 * 这个属性主要是双保险，以及给后续如果接回第三方 CDN 留口子。
 */

import { type ImgHTMLAttributes } from "react";

// 用 Omit 排除 src，因为我们要重新声明它的可空类型。
export interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
}

export function SafeImage({ src, alt, ...rest }: SafeImageProps) {
  if (!src) {
    // 没有图源就不渲染 <img>；调用方一般会包一层 placeholder div。
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      referrerPolicy="no-referrer"
      loading={rest.loading ?? "lazy"}
      decoding={rest.decoding ?? "async"}
      {...rest}
    />
  );
}
