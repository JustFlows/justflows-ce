// SPDX-License-Identifier: MIT
import { coreBlocks } from "@justflows/blocks";
import { useT } from "../i18n/I18nProvider";

const definitions = new Map(coreBlocks.filter((block) => ["core.video", "core.audio", "core.file"].includes(block.type)).map((block) => [block.type, block]));

export default function MediaBlock({ type, props, preview = false }: {
  type: string;
  props: Record<string, unknown>;
  preview?: boolean;
}) {
  const { t } = useT();
  const definition = definitions.get(type);
  if (!definition) return null;
  const validated = definition.validateProps(preview && type !== "core.file"
    ? { ...props, autoplay: false, controls: true }
    : props);
  if (!validated.src) return <div className="jf-media-placeholder">{t("builder.media.addUrl")}</div>;
  // Only fixed core renderers generate this markup, with validated URLs and escaped text.
  return <div dangerouslySetInnerHTML={{ __html: definition.render(validated) }} />;
}
