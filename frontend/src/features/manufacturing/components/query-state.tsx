import { LocalState } from "../../../components/product/page-layout.js";

export function SectionSkeleton() {
  return <LocalState kind="loading" title="正在读取" compact />;
}

export function InlineError({ title, detail }: { title: string; detail: string }) {
  return <LocalState kind="error" title={title} detail={detail} compact />;
}

export function InlineEmpty({ message = "暂无生成结果" }: { message?: string }) {
  return <LocalState kind="empty" title={message} compact />;
}
