import { fileURLToPath } from "node:url";

const brandLoader = fileURLToPath(
  new URL("../../scripts/branding/site-loader.cjs", import.meta.url),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@kaneo/branding"],
  turbopack: {
    rules: {
      "*.{ts,tsx,js,jsx}": { loaders: [brandLoader] },
    },
  },
  webpack(config) {
    config.module.rules.unshift({
      test: /\.[jt]sx?$/,
      include: [
        fileURLToPath(new URL("./app", import.meta.url)),
        fileURLToPath(new URL("./components", import.meta.url)),
        fileURLToPath(new URL("./lib", import.meta.url)),
      ],
      use: [brandLoader],
    });
    return config;
  },
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default nextConfig;
