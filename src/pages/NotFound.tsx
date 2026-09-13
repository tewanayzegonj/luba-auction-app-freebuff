import { motion } from "framer-motion";
import { Link } from "react-router";
import { LubaWordmark } from "@/components/luba";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col bg-background"
    >
      <div className="px-4 py-5 sm:px-6">
        <LubaWordmark />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24 text-center">
        <p className="font-mono text-6xl font-bold tracking-tight text-foreground/90">
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          The page you requested doesn't exist. It may have been moved, or the
          address may be mistyped.
        </p>
        <div className="mt-7 flex gap-2">
          <Button asChild>
            <Link to="/">Back to open auctions</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard">Your dashboard</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
