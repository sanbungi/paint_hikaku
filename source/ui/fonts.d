module ui.fonts;

import dlangui;
import dlangui.graphics.fonts;
import engine.fontpaths;
import std.file : exists;

/// dlangui の既定は Arial/DejaVu のみで日本語が豆腐になる。CJK フォントを Arial としても登録する。
void installUiFonts()
{
    static if (ENABLE_FREETYPE)
    {
        import dlangui.graphics.ftfonts : FreeTypeFontManager;

        auto ft = cast(FreeTypeFontManager) FontManager.instance;
        if (ft is null)
            return;

        foreach (p; cjkFontCandidates())
        {
            if (!exists(p))
                continue;
            // テーマ既定の "Arial" に載せる（DejaVu より完全一致が勝つ）
            ft.registerFont(p, FontFamily.SansSerif, "Arial", false, FontWeight.Normal);
            ft.registerFont(p, FontFamily.SansSerif, "AppUI", false, FontWeight.Normal);
            if (currentTheme !is null)
            {
                currentTheme.fontFace = "AppUI";
                currentTheme.fontSize = makePointSize(11);
            }
            return;
        }
    }
}
