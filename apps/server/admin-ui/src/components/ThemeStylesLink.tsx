

import { useEffect, useState } from "react";

/** Loads theme.css — uses preview mode when ?preview=1 is in the URL. */
export default function ThemeStylesLink() {
  const [href, setHref] = useState("/theme.css");

  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    setHref(preview ? "/theme.css?preview=1" : "/theme.css");
  }, []);

  return <link rel="stylesheet" href={href} />;
}
