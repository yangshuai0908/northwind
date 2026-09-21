import { CreditCardIcon, HeadphonesIcon, ShieldCheckIcon, TruckIcon } from "lucide-react";

const items = [
    {
        icon: TruckIcon,
        title: "实现",
        desc: "结构化目录和库存准备模型",
    },
    {
        icon: ShieldCheckIcon,
        title: "安全支付",
        desc: "加密支付和订单确认",
    },
    {
        icon: CreditCardIcon,
        title: "透明",
        desc: "价格以美元计，如适用需缴税",
    },
    {
        icon: HeadphonesIcon,
        title: "人工支持",
        desc: "基于订单的聊天 + 可选视频",
    },
];

export function TrustStrip() {
    return (
        <section className="grid gap-4 rounded-box border border-base-300 bg-base-100 p-6 sm:grid-cols-2 lg:grid-cols-4">
            {items.map(({ icon, title, desc }) => {
                const IconCmp = icon;
                return (
                    <div key={title} className="flex gap-3">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <IconCmp className="size-5" aria-hidden />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base-content">{title}</h3>
                            <p className="mt-0.5 text-sm text-base-content/65">{desc}</p>
                        </div>
                    </div>
                );
            })}
        </section>
    );
}