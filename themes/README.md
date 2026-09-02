# Themes

Themes supply CSS, block patterns, a WordPress-style template hierarchy
(`templates/*.json` + `parts/*.json`, block documents rather than PHP), and
optional demo home and blog layouts. They do not replace the core document
shell (`layout.ejs`).

See [docs/THEMES.md](../docs/THEMES.md) for resolution order and file layout.
The bundled example is `themes/default`; any other theme folder placed here is
registered automatically on the admin themes/customizer load.
