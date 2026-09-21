import { Link } from "react-router";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";

export function HomeHero({ categories, loadingCategories }) {
    return (
        <section className="relative overflow-hidden rounded-box border border-base-300 bg-linear-to-br from-base-100 via-base-100 to-primary/10 shadow-lg">
            <div
                className="absolute right-0 top-0 h-64 w-64 translate-x-1/4 -translate-y-1/4 rounded-full bg-primary/10 blur-3xl"
                aria-hidden
            />

            <div className="relative grid gap-8 p-8 md:grid-cols-2 md:items-center md:p-12 lg:p-14">
                <div className="text-left">
                    <h1 className="text-3xl font-bold tracking-tight text-base-content md:text-4xl lg:text-5xl">
                        硬件 &amp; 工作空间, <span className="text-primary">准备出货</span>
                    </h1>

                    <p className="mt-4 max-w-lg text-base leading-relaxed text-base-content/70">
                        音频，可穿戴设备，工作区和旅行为工作和家庭策划。安全检验;
                        付款后，使用您的订单页面支持聊天和视频。
                    </p>

                    <div className="mt-6 flex flex-wrap gap-3">
                        <a href="#catalog" className="btn btn-primary gap-2 shadow-md">
                            商店目录
                            <ArrowRightIcon className="size-4" aria-hidden />
                        </a>

                        <Link to="/cart" className="btn btn-outline btn-primary">
                            购物车
                        </Link>
                    </div>
                </div>

                <div className="grid gap-3">
                    <div className="stat rounded-box border border-base-300 bg-base-100/80 px-4 py-3 shadow-sm">
                        <div className="stat-title text-xs uppercase text-base-content/50">分类</div>

                        <div className="stat-value text-2xl text-secondary">
                            {loadingCategories ? (
                                <span className="skeleton inline-block h-8 w-10 rounded" aria-hidden />
                            ) : (
                                categories.length
                            )}
                        </div>

                        <div className="stat-desc text-xs">精选小组</div>
                    </div>

                    <div className="rounded-box border border-dashed border-primary/30 bg-primary/5 px-4 py-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-base-content">
                            <SparklesIcon className="size-4 text-primary" aria-hidden />
                            对已付款订单的优先支持
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}