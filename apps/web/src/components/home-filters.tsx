"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  CircleDollarSign,
  Compass,
  LoaderCircle,
  MapPin,
  Store,
  UserRound,
  X,
} from "lucide-react";
import {
  primaryShopCategories,
  secondaryCuisines,
  shopCategoryOptions,
} from "@gowith/shared";
import { apiBaseUrl } from "@/lib/api";

const SORT_OPTIONS = [
  { value: "recommended", label: "综合推荐" },
  { value: "distance", label: "离我最近" },
  { value: "latest", label: "最新发布" },
  { value: "ai_score", label: "AI 评分高" },
  { value: "amap_rating", label: "高德评分高" },
  { value: "price_asc", label: "人均从低到高" },
  { value: "price_desc", label: "人均从高到低" },
];
const SORT_VALUES = new Set(SORT_OPTIONS.map((option) => option.value));
const CATEGORY_VALUES = new Set<string>(shopCategoryOptions);

type CreatorOption = {
  id: string;
  name: string;
  bilibili_uid: string;
  shop_count?: number;
};

type FormState = {
  sort: string;
  city: string;
  category: string;
  creatorId: string;
  minAvgCost: string;
  maxAvgCost: string;
  hasDianping: boolean;
};

function readFormState(searchParams: URLSearchParams): FormState {
  const sort = searchParams.get("sort") ?? "recommended";
  const category = searchParams.get("category") ?? "";
  return {
    sort: SORT_VALUES.has(sort) ? sort : "recommended",
    city: searchParams.get("city") ?? "",
    category: CATEGORY_VALUES.has(category) ? category : "",
    creatorId: searchParams.get("creator_id") ?? "",
    minAvgCost: searchParams.get("min_avg_cost") ?? "",
    maxAvgCost: searchParams.get("max_avg_cost") ?? "",
    hasDianping: searchParams.get("has_dianping") === "true",
  };
}

export function HomeFilters({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const currentState = useMemo(
    () => readFormState(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const [values, setValues] = useState<FormState>(currentState);
  const [creators, setCreators] = useState<CreatorOption[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(false);

  useEffect(() => {
    setValues(currentState);
  }, [currentState]);

  useEffect(() => {
    let cancelled = false;
    setLoadingCreators(true);
    fetch(`${apiBaseUrl}/api/creators`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`creators_${response.status}`);
        return response.json() as Promise<{ creators: CreatorOption[] }>;
      })
      .then((payload) => {
        if (!cancelled) setCreators(payload.creators ?? []);
      })
      .catch(() => {
        if (!cancelled) setCreators([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCreators(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (values.sort !== "recommended") params.set("sort", values.sort);
    if (values.city.trim()) params.set("city", values.city.trim());
    if (CATEGORY_VALUES.has(values.category)) {
      params.set("category", values.category);
    }
    if (values.creatorId) params.set("creator_id", values.creatorId);
    if (values.minAvgCost.trim())
      params.set("min_avg_cost", values.minAvgCost.trim());
    if (values.maxAvgCost.trim())
      params.set("max_avg_cost", values.maxAvgCost.trim());
    if (values.hasDianping) params.set("has_dianping", "true");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function clearAll() {
    setValues({
      sort: "recommended",
      city: "",
      category: "",
      creatorId: "",
      minAvgCost: "",
      maxAvgCost: "",
      hasDianping: false,
    });
    router.push(pathname);
  }

  return (
    <aside className="h-fit rounded-lg border border-line bg-white p-4">
      <h1 className="text-xl font-semibold">推荐店铺</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        以 B站探店博主为索引，按你的偏好筛选已审核店铺卡片。
      </p>
      <form className="mt-5 space-y-3 text-sm" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            <ArrowDownUp size={12} />
            排序
          </span>
          <select
            value={values.sort}
            onChange={(event) => update("sort", event.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            <MapPin size={12} />
            省份 / 城市
          </span>
          <input
            value={values.city}
            onChange={(event) => update("city", event.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-line px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="广东 / 上海 / 成都"
            name="city"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            <Store size={12} />
            品类 / 菜系
          </span>
          <select
            value={values.category}
            onChange={(event) => update("category", event.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            name="category"
          >
            <option value="">全部品类</option>
            <optgroup label="主品类">
              {primaryShopCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </optgroup>
            <optgroup label="二级菜系">
              {secondaryCuisines.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            <UserRound size={12} />
            博主
          </span>
          <select
            value={values.creatorId}
            onChange={(event) => update("creatorId", event.target.value)}
            disabled={disabled || loadingCreators}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {loadingCreators ? "正在加载博主" : "全部博主"}
            </option>
            {creators.map((creator) => (
              <option key={creator.id} value={creator.id}>
                {creator.name} · {creator.shop_count ?? 0} 店
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            <CircleDollarSign size={12} />
            高德人均
          </span>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={values.minAvgCost}
              onChange={(event) => update("minAvgCost", event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-line px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
              inputMode="numeric"
              placeholder="最低"
              name="min_avg_cost"
            />
            <input
              value={values.maxAvgCost}
              onChange={(event) => update("maxAvgCost", event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-line px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
              inputMode="numeric"
              placeholder="最高"
              name="max_avg_cost"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
          <input
            type="checkbox"
            checked={values.hasDianping}
            onChange={(event) => update("hasDianping", event.target.checked)}
            disabled={disabled}
            className="size-4 accent-[#c15f3c] disabled:cursor-not-allowed"
          />
          <span className="inline-flex items-center gap-1 text-xs font-medium">
            <CheckCircle2 size={13} />
            仅看有大众点评链接
          </span>
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {disabled ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Compass size={13} />
            )}
            应用
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X size={13} />
            清空
          </button>
        </div>
      </form>
    </aside>
  );
}
