import { Link } from "react-router";

export function SentryErrorFallback() {
    return (
        <div className="mx-auto max-w-md rounded-box border border-base-300 bg-base-100 p-8 text-center">
            <p className="text-base-content/80">出了什么问题。报告错误。</p>

            <Link to="/" className="btn btn-primary btn-sm mt-6">
                回到商店
            </Link>
        </div>
    );
}