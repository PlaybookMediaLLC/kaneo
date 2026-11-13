/** True when a request wants an HTML navigation rather than the route's JSON contract. */
export function prefersBrowserNavigation(headers: Headers) {
  if (headers.get("sec-fetch-mode")?.toLowerCase() === "navigate") return true;

  const ranges = (headers.get("accept") ?? "").split(",").map((part) => {
    const [type = "", ...parameters] = part.trim().toLowerCase().split(";");
    const qualityParameter = parameters.find((parameter) =>
      /^q\s*=/.test(parameter.trim()),
    );
    const quality = qualityParameter
      ? /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.exec(
          qualityParameter.trim(),
        )?.[1]
      : undefined;
    return {
      type,
      quality:
        qualityParameter === undefined
          ? 1
          : quality === undefined
            ? 0
            : Number(quality),
    };
  });
  const quality = (type: string) => {
    const [group] = type.split("/");
    for (const candidate of [type, `${group}/*`, "*/*"]) {
      const match = ranges.find((range) => range.type === candidate);
      if (match) return match.quality;
    }
    return 0;
  };
  return quality("text/html") > quality("application/json");
}
