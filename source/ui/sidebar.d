module ui.sidebar;

import dlangui;
import dlangui.widgets.scroll;

/// A vertical viewport: long labels must not increase the scrollable width.
class SidebarScroll : ScrollWidget
{
    this(string id)
    {
        // Keep both scrollbar objects: dlangui's layout dereferences both even
        // when only vertical scrolling is needed. Width constraint hides X.
        super(id, ScrollBarMode.Auto, ScrollBarMode.Auto);
    }

    protected override void checkIfScrollbarsNeeded(ref bool horizontal, ref bool vertical)
    {
        horizontal = false;
        vertical = fullContentSize().y > _clientRect.height;
    }

    @property bool horizontalOverflow() { return _hscrollbar.visibility == Visibility.Visible; }

    override dlangui.core.types.Point fullContentSize()
    {
        import std.algorithm : max;
        int width = max(1, _clientRect.width);
        int height;
        if (_contentWidget !is null)
        {
            _contentWidget.measure(width, SIZE_UNSPECIFIED);
            height = _contentWidget.measuredHeight;
        }
        _fullScrollableArea.right = width;
        _fullScrollableArea.bottom = height;
        return dlangui.core.types.Point(width, height);
    }
}
