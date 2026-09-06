module ui.fonts;

import dlangui;
import dlangui.graphics.fonts;
import engine.fontpaths;
import std.file : exists;

/// dlangui の既定は Arial/DejaVu のみで日本語が豆腐になる。CJK フォントを Arial としても登録する。
bool installUiFonts()
{
    static if (ENABLE_FREETYPE)
    {
        import dlangui.graphics.ftfonts : FreeTypeFontManager;

        auto ft = cast(FreeTypeFontManager) FontManager.instance;
        if (ft is null)
            return false;

        foreach (p; cjkFontCandidates())
        {
            if (!exists(p))
                continue;
            // テーマ既定の "Arial" に載せる（DejaVu より完全一致が勝つ）
            ft.registerFont(p, FontFamily.SansSerif, "Arial", false, FontWeight.Normal);
            if (!ft.registerFont(p, FontFamily.SansSerif, "AppUI", false, FontWeight.Normal))
                continue;
            if (currentTheme !is null)
            {
                currentTheme.fontFace = "AppUI";
                currentTheme.fontSize = makePointSize(11);
            }
            return true;
        }
    }
    return false;
}
