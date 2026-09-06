module app;

import dlangui;
import dlangui.dialogs.filedlg;
import dlangui.dialogs.dialog;
import dlangui.graphics.images;
import dlangui.widgets.groupbox;
import dlangui.widgets.scrollbar;
import dlangui.widgets.scroll;
import ui.canvas;
import ui.fonts;
import ui.sidebar;
import engine.types;
import engine.templates;
import engine.perspective;
import engine.solids;
import engine.diagnose;
import engine.raster;
import engine.session;
import store.history;
import std.conv : to;
import std.format : format;
import std.array : join;
import std.algorithm : min, max;
import std.math : abs;

mixin APP_ENTRY_POINT;

extern (C) int UIAppMain(string[] args)
{
    bool fontsReady = installUiFonts();
    import bindbc.sdl : SDL_GetDisplayBounds, SDL_Rect;
    int width = 1280, height = 800;
    SDL_Rect desktop;
    if (SDL_GetDisplayBounds(0, &desktop) == 0)
    {
        width = min(width, desktop.w * 9 / 10);
        height = min(height, desktop.h * 9 / 10);
    }
    import std.algorithm : canFind;
    bool smoke = args.canFind("--smoke-test");
    version (GuiRegression) smoke = true;
    if (smoke)
    {
        import std.process : environment;
        import std.exception : enforce;
        enforce(environment.get("PAINT_HIKAKU_DATA_DIR", "").length > 0,
                "Smoke tests require an isolated PAINT_HIKAKU_DATA_DIR");
        enforce(fontsReady, "Japanese UI font registration failed");
    }
    auto win = Platform.instance.createWindow("paint_hikaku", null, WindowFlag.Resizable, width, height);
    auto studio = new Studio();
    win.mainWidget = studio;
    win.show();
    if (smoke)
    {
        studio.loadEmbeddedSample();
        studio.smokeRequested = true;
    }
    else if (args.length > 1)
        studio.openImagePath(args[1]);
    return Platform.instance.enterMessageLoop();
}

version (GuiRegression) void runGuiRegression(Studio s)
{
    import std.exception : enforce;
    import std.stdio : writeln;
    import std.file : mkdirRecurse;
    import std.process : environment;
    import std.path : buildPath;
    import arsd.png : writePng, PngType;
    auto output = environment.get("PAINT_HIKAKU_TEST_OUTPUT", "test-results");
    mkdirRecurse(output);
    void screenshot(string name)
    {
        auto buf = new ColorDrawBuf(s.pos.width, s.pos.height);
        scope(exit) destroy(buf);
        buf.fill(0x00ffffff);
        s.onDraw(buf);
        ubyte[] rgb = new ubyte[buf.width * buf.height * 3];
        foreach (y; 0 .. buf.height) foreach (x; 0 .. buf.width)
        {
            auto p = buf.scanLine(y)[x];
            auto offset = (y * buf.width + x) * 3;
            rgb[offset] = cast(ubyte)(p >> 16);
            rgb[offset + 1] = cast(ubyte)(p >> 8);
            rgb[offset + 2] = cast(ubyte)p;
        }
        writePng(buildPath(output, name ~ ".png"), rgb, buf.width, buf.height, PngType.truecolor);
    }
    scope(failure) screenshot("failure");
    writeln("RUN GUI-EVENTS");
    s.tplCombo.itemClick(s.tplCombo, 1);
    enforce(s.templateId == "circle" && s.tplList.selectedItemIndex == 1, "Template selectors disagree");
    auto paper = s.paperView;
    auto rc = paper.pos;
    auto x = cast(short)(rc.left + rc.width / 2);
    auto y = cast(short)(rc.top + min(rc.width, rc.height) / 2);
    enforce(paper.onMouseEvent(new MouseEvent(MouseAction.ButtonDown, MouseButton.Left, 0, x, y)), "Draw down ignored");
    paper.onMouseEvent(new MouseEvent(MouseAction.Move, MouseButton.Left, 0, cast(short)(x + 10), y));
    paper.onMouseEvent(new MouseEvent(MouseAction.ButtonUp, MouseButton.Left, 0, x, y));
    enforce(s.board.strokes.length == 1, "Stroke not committed");
    s.btnCheck.click(s.btnCheck);
    enforce(s.board.resultMode, "Check button disconnected");
    s.btnSave.click(s.btnSave);
    enforce(s.savedThisResult && s.recs.length == 1, "Save button disconnected");
    s.btnSave.click(s.btnSave);
    enforce(s.recs.length == 1, "Duplicate save");
    s.alignBox.checkChange(s.alignBox, true);
    enforce(!s.savedThisResult && s.board.alignMode == AlignMode.centroid, "Alignment did not invalidate save");
    s.btnSave.click(s.btnSave);
    enforce(s.recs.length == 2, "Changed result not saved");
    foreach (i; 0 .. 4) s.overlayCombo.itemClick(s.overlayCombo, i);
    s.btnAgain.click(s.btnAgain);
    enforce(!s.board.resultMode && s.board.strokes.length == 0, "Again failed");
    foreach (endAction; [MouseAction.ButtonUp, MouseAction.Cancel])
    {
        paper.onMouseEvent(new MouseEvent(MouseAction.ButtonDown, MouseButton.Left, 0, x, y));
        paper.onMouseEvent(new MouseEvent(endAction, MouseButton.Left, 0, -1, -1));
        enforce(!s.board.drawing && s.board.current.points.length == 0, "Unfinished stroke after outside release/cancel");
    }
    enforce(s.board.strokes.length == 2, "Outside release lost strokes");
    s.btnUndo.click(s.btnUndo);
    enforce(s.board.strokes.length == 1, "Undo did not remove exactly one stroke");
    s.btnClear.click(s.btnClear);
    enforce(s.board.strokes.length == 0, "Clear did not remove strokes");
    enforce(pressureFromEvent(new MouseEvent(MouseAction.Move, MouseButton.Left, MouseFlag.Shift, x, y), true) == 0.4f,
            "Shift pressure fallback changed");
    writeln("PASS GUI-EVENTS");
    writeln("RUN GUI-IMAGES");
    {
        import arsd.color : TrueColorImage, Color;
        import arsd.jpeg : writeJpeg;
        import std.file : write;
        auto fixture = new TrueColorImage(80, 40);
        foreach (iy; 0 .. 40) foreach (ix; 0 .. 80)
            fixture.setPixel(ix, iy, ix < 40 ? Color(220, 40, 40) : Color(20, 20, 20));
        foreach (extension; ["png", "jpg"])
        {
            auto path = buildPath(output, "日本語 image." ~ extension);
            if (extension == "png") writePng(path, fixture);
            else writeJpeg(path, fixture);
            s.openImagePath(path);
            enforce(s.templateId == "image:" ~ path, "Image load failed: " ~ extension);
            auto color = s.board.tplColor;
            auto center = (CanvasSize / 2 * CanvasSize + CanvasSize / 3) * 4;
            enforce(color[center] > color[center + 1] + 80, "Image lost its color");
            enforce(color[0 .. 4] == [250, 249, 245, 255], "Aspect ratio padding was lost");
            auto oldMask = s.board.tpl.px.dup;
            s.perspMode.itemClick(s.perspMode, 0);
            enforce(s.board.tpl.px == oldMask && s.board.tplColor == color, "Perspective changed image");
        }
        auto oldId = s.templateId;
        s.openImagePath(buildPath(output, "missing.png"));
        enforce(s.templateId == oldId, "Missing image changed current template");
        auto invalid = buildPath(output, "corrupt.png");
        write(invalid, "invalid image");
        s.openImagePath(invalid);
        enforce(s.templateId == oldId, "Corrupt image changed current template");
    }
    writeln("PASS GUI-IMAGES");
    foreach (slider; [s.slYaw, s.slPitch, s.slDist, s.slHorizon])
    {
        auto minus = s.childById!Button(slider.id ~ "-minus");
        auto plus = s.childById!Button(slider.id ~ "-plus");
        int initial = slider.position;
        plus.click(plus);
        enforce(slider.position == initial + 1, "Slider increment failed");
        minus.click(minus);
        enforce(slider.position == initial, "Slider decrement failed");
        slider.position = slider.minValue;
        minus.click(minus);
        enforce(slider.position == slider.minValue, "Slider below minimum");
        slider.position = slider.maxValue - slider.pageSize;
        plus.click(plus);
        enforce(slider.position == slider.maxValue - slider.pageSize, "Slider above maximum");
        slider.position = initial;
        slider.sendScrollEvent(ScrollAction.SliderReleased, initial);
    }
    writeln("RUN GUI-LAYOUT");
    auto originalDpi = overrideScreenDPI;
    scope(exit) overrideScreenDPI = originalDpi;
    foreach (dpi; [96, 120, 144, 192])
    foreach (size; [dlangui.core.types.Point(1366, 768), dlangui.core.types.Point(1920, 1080)])
    foreach (side; [false, true])
    {
        overrideScreenDPI = dpi;
        s.onThemeChanged();
        s.leftExplicit = s.rightExplicit = false;
        s.layCombo.itemClick(s.layCombo, side ? 1 : 0);
        s.measure(size.x, size.y);
        s.layout(Rect(0, 0, size.x, size.y));
        auto a = s.sampleView.pos, b = s.paperView.pos;
        enforce(a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0, "Empty canvas");
        enforce(side ? a.right <= b.left : a.bottom <= b.top, "Overlapping canvases");
        foreach (button; [s.btnCheck, s.btnAgain, s.btnUndo, s.btnClear, s.btnSave])
        {
            auto position = button.pos;
            enforce(position.width > 0 && position.height > 0 && position.right <= size.x
                    && position.bottom <= size.y, "Action button outside window");
        }
        if (dpi == 192 && size.x == 1366)
        {
            auto settings = s.childById!Button("settings");
            auto diagnosis = s.childById!Button("diagnosis");
            settings.click(settings);
            enforce(s.leftScroll.visibility == Visibility.Visible, "Settings cannot be opened");
            diagnosis.click(diagnosis);
            enforce(s.rightScroll.visibility == Visibility.Visible && s.leftScroll.visibility == Visibility.Gone,
                    "Compact panels overlap drawing area");
            s.measure(size.x, size.y);
            s.layout(Rect(0, 0, size.x, size.y));
        }
        screenshot(format("layout-%d-%d-%s", dpi, size.x, side ? "side" : "stack"));
        if (s.leftScroll.visibility == Visibility.Visible)
        {
            enforce(s.leftScroll.fullContentSize.x <= s.leftScroll.pos.width,
                    "Sidebar content overflows horizontally");
            enforce(!(cast(SidebarScroll)s.leftScroll).horizontalOverflow,
                    "Sidebar has an unnecessary horizontal scrollbar");
            enforce(s.slYaw.pos.width > pointsToPixels(60), "Slider track too narrow");
            enforce(s.slYaw.pos.right <= s.leftScroll.pos.right, "Slider outside sidebar");
            auto help = s.childById!TextWidget("guideHelp");
            enforce(help.pos.height > s.labYaw.pos.height, "Sidebar help did not wrap");
        }
    }
    writeln("PASS GUI-LAYOUT");
}

final class Studio : VerticalLayout
{
    PracticeSession session;
    @property string templateId() { return session.templateId; }
    @property bool savedThisResult() { return session.saved; }
    @property void savedThisResult(bool value) { session.saved = value; }
    @property ref PerspSettings persp() { return session.perspective; }
    BoardState board;
    BoardView sampleView;
    BoardView paperView;
    LinearLayout canvasFrame;
    LinearLayout actionStrip;
    TextWidget labSample;
    TextWidget labPaper;
    ComboBox layCombo;
    ComboBox tplCombo;
    bool syncingTemplate;
    ScrollWidget leftScroll, rightScroll;
    bool leftExplicit, rightExplicit;
    bool compactLayout;
    EditBox trendText;
    ulong peekTimerId;
    ulong peekGeneration;
    ulong smokeTimerId;
    bool smokeDrawn;
    bool smokeRequested;
    SliderWidget slWipe;
    TextWidget labWipe;
    StringListWidget tplList;
    StringListWidget histList;
    ComboBox overlayCombo;
    CheckBox alignBox;
    EditBox diagText;
    TextWidget status;
    Button btnCheck, btnAgain, btnSave, btnUndo, btnClear;
    TemplateDef[] catalog;
    SessionRecord[] recs;
    ComboBox perspMode;
    SliderWidget slYaw, slPitch, slDist, slHorizon;
    TextWidget labYaw, labPitch, labDist, labHorizon;
    CheckBox chkGuides, chkHidden;

    this()
    {
        super("studio");
        session = new PracticeSession();
        board = session.board;
        layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        padding(Rect(4, 4, 4, 4));
        fontFace = "AppUI";
        fontSize = makePointSize(11);
        catalog = builtinCatalog();

        auto bar = new HorizontalLayout();
        bar.layoutWidth(FILL_PARENT);
        auto btnOpen = new Button("open", "画像を開く…"d);
        auto btnSample = new Button("sample", "サンプル画像"d);
        btnOpen.click = delegate(Widget w) { openFileDlg(); return true; };
        btnSample.click = delegate(Widget w) { loadEmbeddedSample(); return true; };
        layCombo = new ComboBox("lay", ["上下に並べる"d, "左右に並べる"d]);
        layCombo.selectedItemIndex = 1;
        layCombo.itemClick = delegate(Widget w, int i) {
            setSideBySide(i == 1);
            return true;
        };
        auto gridCombo = new ComboBox("grid", ["グリッドなし"d, "2分割"d, "3×3"d, "4×4"d]);
        gridCombo.selectedItemIndex = 0;
        gridCombo.itemClick = delegate(Widget w, int i) {
            int[] ns = [0, 2, 3, 4];
            board.gridN = ns[i];
            refreshBoards();
            return true;
        };
        auto chkBox = new CheckBox("bbox", "外接箱"d);
        chkBox.checkChange = delegate(Widget w, bool c) {
            board.showBBox = c;
            refreshBoards();
            return true;
        };
        auto chkMem = new CheckBox("mem", "記憶模写"d);
        chkMem.checkChange = delegate(Widget w, bool c) {
            session.memory(c);
            refreshBoards();
            updateDiagLive();
            return true;
        };
        auto btnPeek = new Button("peek", "チラ見"d);
        btnPeek.click = delegate(Widget w) {
            if (peekTimerId) cancelTimer(peekTimerId);
            peekGeneration = session.peek();
            refreshBoards();
            peekTimerId = setTimer(1800);
            return true;
        };
        auto chkPr = new CheckBox("pr", "筆圧（マウスはShift細/Ctrl太）"d);
        chkPr.checked = true;
        chkPr.checkChange = delegate(Widget w, bool c) {
            board.usePressure = c;
            return true;
        };
        bar.addChild(new TextWidget(null, "配置"d));
        bar.addChild(layCombo);
        bar.addChild(gridCombo);
        bar.addChild(chkBox);
        auto barScroll = new ScrollWidget("toolbar", ScrollBarMode.Auto, ScrollBarMode.Invisible);
        barScroll.layoutWidth(FILL_PARENT).layoutHeight(makePointSize(36));
        barScroll.contentWidget = bar;
        addChild(barScroll);
        auto extraBar = new HorizontalLayout();
        extraBar.layoutWidth(FILL_PARENT);
        extraBar.addChild(chkMem);
        extraBar.addChild(btnPeek);
        extraBar.addChild(chkPr);
        extraBar.addChild(new HSpacer());
        extraBar.addChild(btnOpen);
        extraBar.addChild(btnSample);
        auto extraScroll = new ScrollWidget("tools", ScrollBarMode.Auto, ScrollBarMode.Invisible);
        extraScroll.layoutWidth(FILL_PARENT).layoutHeight(makePointSize(36));
        extraScroll.contentWidget = extraBar;
        addChild(extraScroll);

        btnUndo = new Button("undo", "アンドゥ"d);
        btnClear = new Button("clear", "クリア"d);
        btnCheck = new Button("check", "答え合わせ"d);
        btnAgain = new Button("again", "もう一度"d);
        btnSave = new Button("save", "記録"d);
        btnUndo.click = delegate(Widget w) { session.undo(); refreshBoards(); updateDiagLive(); return true; };
        btnClear.click = delegate(Widget w) { session.clear(); refreshBoards(); updateDiagLive(); return true; };
        btnCheck.click = delegate(Widget w) { doCheck(); return true; };
        btnAgain.click = delegate(Widget w) { session.clear(); refreshBoards(); updateDiagLive(); return true; };
        btnSave.click = delegate(Widget w) { persist(); return true; };
        foreach (b; [btnUndo, btnClear, btnCheck, btnAgain, btnSave])
            b.layoutWidth(FILL_PARENT);

        auto body = new HorizontalLayout();
        body.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);

        auto left = new VerticalLayout();
        left.layoutWidth(FILL_PARENT).layoutHeight(WRAP_CONTENT);
        left.addChild(new TextWidget(null, "お手本"d).fontSize(makePointSize(18)));
        dstring[] names;
        foreach (t; catalog)
            names ~= to!dstring(t.labelJa);
        names ~= "サンプル画像"d;
        names ~= "外部画像"d;
        tplCombo = new ComboBox("tplCombo", names);
        tplCombo.layoutWidth(FILL_PARENT);
        tplCombo.itemClick = delegate(Widget src, int index) {
            applyTemplateIndex(index);
            return true;
        };
        left.addChild(tplCombo);
        tplList = new StringListWidget("tpls", names);
        tplList.layoutWidth(FILL_PARENT).layoutHeight(makePointSize(200));
        tplList.itemSelected = delegate(Widget src, int index) {
            applyTemplateIndex(index);
            return true;
        };
        tplList.itemClick = delegate(Widget src, int index) {
            applyTemplateIndex(index);
            return true;
        };
        left.addChild(tplList);

        auto pg = new GroupBox("perspBox", UIString.fromRaw("パース設定"d));
        pg.layoutWidth(FILL_PARENT);
        perspMode = new ComboBox("pmode", ["1点透視"d, "2点透視"d, "3点透視"d, "アイソメ"d]);
        perspMode.selectedItemIndex = 1;
        perspMode.layoutWidth(FILL_PARENT);
        perspMode.itemClick = delegate(Widget w, int i) {
            persp.mode = cast(PerspMode) i;
            applyPersp(false);
            return true;
        };
        pg.addChild(perspMode);
        labYaw = new TextWidget(null, "水平角 32°"d);
        slYaw = makeSlider("yaw", 0, 70, 32);
        slYaw.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.yawDeg = s.position;
            labYaw.text = to!dstring(format("水平角 %d°", persp.yawDeg));
            applyPersp(false);
            return true;
        };
        pg.addChild(labYaw);
        pg.addChild(sliderRow(slYaw));
        labPitch = new TextWidget(null, "上下角 16°"d);
        slPitch = makeSlider("pitch", -30, 35, 16);
        slPitch.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.pitchDeg = s.position;
            labPitch.text = to!dstring(format("上下角 %d°", persp.pitchDeg));
            applyPersp(false);
            return true;
        };
        pg.addChild(labPitch);
        pg.addChild(sliderRow(slPitch));
        labDist = new TextWidget(null, "距離 55"d);
        slDist = makeSlider("dist", 1, 90, 55);
        slDist.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.dist = s.position;
            labDist.text = to!dstring(format("距離 %d", persp.dist));
            applyPersp(false);
            return true;
        };
        pg.addChild(labDist);
        pg.addChild(sliderRow(slDist));
        labHorizon = new TextWidget(null, "地平線 42%"d);
        slHorizon = makeSlider("hor", 20, 80, 42);
        slHorizon.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            persp.horizonPct = s.position;
            labHorizon.text = to!dstring(format("地平線 %d%%", persp.horizonPct));
            applyPersp(false);
            return true;
        };
        pg.addChild(labHorizon);
        pg.addChild(sliderRow(slHorizon));
        chkGuides = new CheckBox("g", "補助線"d);
        chkGuides.checked = true;
        chkGuides.checkChange = delegate(Widget w, bool c) {
            persp.showGuides = c;
            applyPersp(false);
            return true;
        };
        chkHidden = new CheckBox("h", "隠れ線（薄）"d);
        chkHidden.checked = true;
        chkHidden.checkChange = delegate(Widget w, bool c) {
            persp.showHidden = c;
            applyPersp(false);
            return true;
        };
        pg.addChild(chkGuides);
        pg.addChild(chkHidden);
        auto guideHelp = new MultilineTextWidget("guideHelp",
                "青い線がお手本。灰色の補助線（地平線・消失点）と隠れ線は採点対象外です。"d);
        guideHelp.maxLines = 20;
        guideHelp.layoutWidth(FILL_PARENT).fontSize(makePointSize(11));
        pg.addChild(guideHelp);
        left.addChild(pg);

        left.addChild(new VSpacer());
        left.addChild(new TextWidget(null, "履歴（最近）"d).fontSize(makePointSize(16)));
        histList = new StringListWidget("hist");
        histList.layoutWidth(FILL_PARENT).layoutHeight(makePointSize(120));
        left.addChild(histList);
        left.addChild(new TextWidget(null, "この題材の傾向"d).fontSize(makePointSize(14)));
        trendText = new EditBox("trend");
        trendText.readOnly = true;
        trendText.wordWrap = true;
        trendText.fontSize(makePointSize(13));
        trendText.layoutWidth(FILL_PARENT).layoutHeight(makePointSize(90));
        trendText.text = "記録すると、同じ題材のクセがここに溜まります。"d;
        left.addChild(trendText);
        leftScroll = new SidebarScroll("leftScroll");
        leftScroll.layoutWidth(makePointSize(195)).layoutHeight(FILL_PARENT);
        leftScroll.contentWidget = left;
        body.addChild(leftScroll);

        board.onChanged = &updateDiagLive;
        sampleView = new BoardView(board, ViewRole.sample, "sample");
        paperView = new BoardView(board, ViewRole.paper, "paper");
        labSample = new TextWidget(null, "見本"d);
        labSample.layoutWidth(FILL_PARENT);
        labPaper = new TextWidget(null, "キャンバス"d);
        labPaper.layoutWidth(FILL_PARENT);
        auto sampleCol = new VerticalLayout();
        sampleCol.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        sampleCol.layoutWeight = 1;
        sampleCol.addChild(labSample);
        sampleCol.addChild(sampleView);
        auto paperCol = new VerticalLayout();
        paperCol.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        paperCol.layoutWeight = 1;
        paperCol.addChild(labPaper);
        paperCol.addChild(paperView);
        actionStrip = new VerticalLayout("actions");
        auto padTop = new VSpacer();
        padTop.layoutWeight = 1;
        auto padBot = new VSpacer();
        padBot.layoutWeight = 1;
        actionStrip.addChild(padTop);
        actionStrip.addChild(btnCheck);
        actionStrip.addChild(btnAgain);
        actionStrip.addChild(btnUndo);
        actionStrip.addChild(btnClear);
        actionStrip.addChild(btnSave);
        actionStrip.addChild(padBot);
        canvasFrame = new HorizontalLayout("canvasFrame");
        canvasFrame.layoutWidth(FILL_PARENT).layoutHeight(FILL_PARENT);
        canvasFrame.layoutWeight = 3;
        canvasFrame.addChild(sampleCol);
        canvasFrame.addChild(actionStrip);
        canvasFrame.addChild(paperCol);
        body.addChild(canvasFrame);

        auto right = new VerticalLayout();
        right.layoutWidth(FILL_PARENT).layoutHeight(WRAP_CONTENT);
        right.addChild(new TextWidget(null, "答え合わせ"d).fontSize(makePointSize(18)));
        overlayCombo = new ComboBox("ovl", [
            "重ね（青=お手本 / 赤=自分 / 緑=一致）"d,
            "差分"d,
            "ヒートマップ"d,
            "スライド比較"d
        ]);
        overlayCombo.selectedItemIndex = 0;
        overlayCombo.itemClick = delegate(Widget w, int i) {
            if (i == 0)
                board.overlay = OverlayMode.overlay;
            else if (i == 1)
                board.overlay = OverlayMode.diff;
            else if (i == 2)
                board.overlay = OverlayMode.heat;
            else
                board.overlay = OverlayMode.wipe;
            refreshBoards();
            return true;
        };
        right.addChild(overlayCombo);
        labWipe = new TextWidget(null, "スライド位置 50%（左=見本 / 右=自分）"d);
        slWipe = makeSlider("wipe", 0, 100, 50);
        slWipe.scrollEvent = delegate(AbstractSlider s, ScrollEvent e) {
            board.wipePct = s.position;
            if (board.wipePct > 100)
                board.wipePct = 100;
            labWipe.text = to!dstring(format("スライド位置 %d%%（左=見本 / 右=自分）", board.wipePct));
            refreshBoards();
            return true;
        };
        right.addChild(labWipe);
        right.addChild(slWipe);
        alignBox = new CheckBox("align", "重心で位置合わせ（形だけ見る）"d);
        alignBox.checkChange = delegate(Widget w, bool checked) {
            session.setAlignment(checked ? AlignMode.centroid : AlignMode.none);
            if (board.resultMode)
                refreshDiagnosis();
            refreshBoards();
            return true;
        };
        right.addChild(alignBox);
        diagText = new EditBox("diag");
        diagText.text = "上の見本を見て、下の白い紙に模写します。「答え合わせ」で見本に合成されます。"d;
        diagText.layoutWidth(FILL_PARENT).layoutHeight(makePointSize(220));
        diagText.readOnly = true;
        diagText.fontSize(makePointSize(16));
        right.addChild(diagText);
        rightScroll = new ScrollWidget("rightScroll");
        rightScroll.layoutWidth(makePointSize(210)).layoutHeight(FILL_PARENT);
        rightScroll.contentWidget = right;
        body.addChild(rightScroll);
        auto settingsButton = new Button("settings", "題材・設定"d);
        settingsButton.click = delegate(Widget w) {
            leftExplicit = true;
            leftScroll.visibility = leftScroll.visibility == Visibility.Gone ? Visibility.Visible : Visibility.Gone;
            if (compactLayout && leftScroll.visibility == Visibility.Visible)
            {
                rightExplicit = true;
                rightScroll.visibility = Visibility.Gone;
            }
            requestLayout(); return true;
        };
        bar.addChild(settingsButton);
        auto diagnosisButton = new Button("diagnosis", "診断"d);
        diagnosisButton.click = delegate(Widget w) {
            rightExplicit = true;
            rightScroll.visibility = rightScroll.visibility == Visibility.Gone ? Visibility.Visible : Visibility.Gone;
            if (compactLayout && rightScroll.visibility == Visibility.Visible)
            {
                leftExplicit = true;
                leftScroll.visibility = Visibility.Gone;
            }
            requestLayout(); return true;
        };
        bar.addChild(diagnosisButton);

        addChild(body);
        status = new TextWidget("status", "位置合わせなし。点数は参考です。クセを直す練習です。"d);
        addChild(status);
        reloadHistory();
        applyTemplateIndex(1); // 円
        setSideBySide(true);
    }

    void applyTemplateIndex(int index)
    {
        if (index < 0 || index > catalog.length || syncingTemplate)
            return;
        syncingTemplate = true;
        scope(exit) syncingTemplate = false;
        tplCombo.selectedItemIndex = index;
        tplList.selectedItemIndex = index;
        if (index < catalog.length)
            selectShape(catalog[index].id);
        else
            loadEmbeddedSample();
    }

    void selectShape(string id)
    {
        session.select(id);
        refreshBoards();
        refreshTrend();
        updateDiagLive();
    }

    void applyPersp(bool clearUser)
    {
        if (board is null)
            return;
        if (clearUser) session.select(templateId);
        else session.adjustPerspective(persp);
        updateDiagLive();
        refreshBoards();
        if (isSolidId(templateId))
        {
            static immutable string[] modeName = ["1点", "2点", "3点", "アイソメ"];
            auto mi = cast(int) persp.mode;
            if (mi < 0 || mi > 3)
                mi = 1;
            status.text = to!dstring(format("お手本: %s  パース:%s  水平%d° 地平線%d%%",
                    templateId, modeName[mi], persp.yawDeg, persp.horizonPct));
        }
        else
            status.text = to!dstring("お手本: " ~ templateId ~ "（平面。パースは立体サンプル用）");
    }

    SliderWidget makeSlider(string id, int lo, int hi, int pos)
    {
        auto s = new SliderWidget(id);
        s.orientation = Orientation.Horizontal;
        s.minValue = lo;
        s.pageSize = 8;
        s.maxValue = hi + 8;
        s.position = pos;
        s.layoutWidth(FILL_PARENT);
        s.minHeight = makePointSize(22);
        s.maxHeight = makePointSize(28);
        return s;
    }

    Widget sliderRow(SliderWidget slider)
    {
        auto row = new HorizontalLayout();
        row.layoutWidth(FILL_PARENT);
        slider.layoutWeight = 1;
        Button stepButton(string suffix, dstring label, int delta)
        {
            auto button = new Button(slider.id ~ suffix, label);
            button.layoutWidth(makePointSize(28)).minHeight(makePointSize(28));
            button.click = delegate(Widget w) {
                slider.position = max(slider.minValue, min(slider.maxValue - slider.pageSize, slider.position + delta));
                slider.sendScrollEvent(ScrollAction.SliderReleased, slider.position);
                return true;
            };
            return button;
        }
        row.addChild(stepButton("-minus", "−"d, -1));
        row.addChild(slider);
        row.addChild(stepButton("-plus", "+"d, 1));
        return row;
    }

    void updateDiagLive()
    {
        if (!board.resultMode)
        {
            if (board.memoryMode)
                diagText.text = "記憶模写: 見本は隠しています。「チラ見」で数秒だけ出せます。描いて答え合わせ。"d;
            else
                diagText.text = "題材を選び、白い紙に描き、「答え合わせ」で採点します。"d;
        }
    }

    void refreshBoards()
    {
        if (sampleView)
            sampleView.invalidate();
        if (paperView)
            paperView.invalidate();
    }

    void doCheck()
    {
        session.check();
        refreshDiagnosis();
        refreshBoards();
    }

    void refreshDiagnosis()
    {
        auto d = diagnose(board.tpl, board.user, board.strokes, board.alignMode);
        auto m = d.metrics;
        dstring t = to!dstring(format(
                "参考 IoU %.2f\nはみ出し %.0f%%  未到達 %.0f%%\n距離（自分→お手本） %.1f px\n大きさ比 %.2f  ずれ (%.0f, %.0f)\n\n",
                m.iou, m.extraRate * 100, m.missRate * 100,
                m.chamferUserToTpl, m.scaleRatio, m.dx, m.dy));
        foreach (c; d.commentsJa)
            t ~= to!dstring(c) ~ "\n\n"d;
        diagText.text = t;
        status.text = savedThisResult ? "記録済み"d : "未記録 — 「記録」で履歴に残します"d;
    }

    void persist()
    {
        if (!board.resultMode)
        {
            status.text = "先に答え合わせしてください。"d;
            return;
        }
        if (savedThisResult)
        {
            status.text = "この結果は記録済みです。"d;
            return;
        }
        try { session.save(); }
        catch (Exception e)
        {
            status.text = to!dstring("記録できませんでした: " ~ e.msg);
            return;
        }
        reloadHistory();
        status.text = "記録しました。"d;
    }

    void reloadHistory()
    {
        recs = loadRecent();
        dstring[] lines;
        foreach_reverse (r; recs)
            lines ~= to!dstring(format("%s  %s  IoU %.2f", r.isoTime, r.templateId, r.metrics.iou));
        if (!lines.length)
            lines = ["（まだ記録がありません）"d];
        histList.items = lines;
        refreshTrend();
    }

    void refreshTrend()
    {
        if (trendText is null)
            return;
        trendText.text = to!dstring(formatTrend(trendFor(recs, templateId), templateId));
    }

    void setSideBySide(bool side)
    {
        if (canvasFrame is null || actionStrip is null)
            return;
        canvasFrame.orientation = side ? Orientation.Horizontal : Orientation.Vertical;
        actionStrip.orientation = side ? Orientation.Vertical : Orientation.Horizontal;
        if (side)
        {
            labSample.text = "見本"d;
            labPaper.text = "キャンバス"d;
            actionStrip.minWidth = makePointSize(108);
            actionStrip.maxWidth = makePointSize(128);
            actionStrip.layoutWidth = makePointSize(118);
            actionStrip.layoutHeight = FILL_PARENT;
            actionStrip.minHeight = 0;
            actionStrip.maxHeight = 10000;
            foreach (b; [btnUndo, btnClear, btnCheck, btnAgain, btnSave])
                b.layoutWidth(FILL_PARENT);
        }
        else
        {
            labSample.text = "見本"d;
            labPaper.text = "キャンバス"d;
            actionStrip.minWidth = 0;
            actionStrip.maxWidth = 10000;
            actionStrip.layoutWidth = FILL_PARENT;
            actionStrip.minHeight = makePointSize(36);
            actionStrip.maxHeight = makePointSize(44);
            actionStrip.layoutHeight = makePointSize(40);
            foreach (b; [btnUndo, btnClear, btnCheck, btnAgain, btnSave])
                b.layoutWidth(WRAP_CONTENT);
        }
        requestLayout();
        refreshBoards();
    }

    override void measure(int width, int height)
    {
        if (leftScroll !is null && rightScroll !is null)
        {
            bool compact = width < pointsToPixels(1000);
            compactLayout = compact;
            if (!leftExplicit) leftScroll.visibility = compact ? Visibility.Gone : Visibility.Visible;
            if (!rightExplicit) rightScroll.visibility = compact ? Visibility.Gone : Visibility.Visible;
            if (compact && leftScroll.visibility == Visibility.Visible && rightScroll.visibility == Visibility.Visible)
                rightScroll.visibility = Visibility.Gone;
        }
        super.measure(width, height);
    }

    override void onDraw(DrawBuf buf)
    {
        super.onDraw(buf);
        smokeDrawn = true;
        if (smokeRequested && !smokeTimerId) smokeTimerId = setTimer(1);
    }

    override bool onTimer(ulong id)
    {
        if (id == peekTimerId)
        {
            session.expirePeek(peekGeneration);
            peekTimerId = 0;
            refreshBoards();
            return false;
        }
        if (id == smokeTimerId)
        {
            import std.stdio : writeln;
            import core.stdc.stdlib : exit;
            try
            {
                import std.exception : enforce;
                enforce(smokeDrawn, "GUI did not draw");
                enforce(board.tplColor.length > 0, "Embedded image did not load");
                version (GuiRegression) runGuiRegression(this);
                writeln("PASS GUI-SMOKE: window, sample, first draw");
                window.close();
            }
            catch (Throwable error)
            {
                import std.stdio : stderr;
                stderr.writeln(error);
                exit(1);
            }
            return false;
        }
        return super.onTimer(id);
    }
    void openFileDlg()
    {
        auto dlg = new FileDialog(UIString.fromRaw("お手本画像を開く"d), window, null,
                DialogFlag.Modal | DialogFlag.Resizable | FileDialogFlag.Open);
        dlg.filters = [
            FileFilterEntry(UIString.fromRaw("画像"d), "*.png;*.jpg;*.jpeg;*.bmp"),
            FileFilterEntry(UIString.fromRaw("PNG"d), "*.png")
        ];
        dlg.dialogResult = delegate(Dialog d, const Action result) {
            if (result.id != StandardAction.Open)
                return;
            auto fd = cast(FileDialog) d;
            openImagePath(fd.filename);
        };
        dlg.show();
    }

    void openImagePath(string path)
    {
        import std.file : exists;
        if (!exists(path))
        {
            status.text = to!dstring("ファイルがありません: " ~ path);
            return;
        }
        ColorDrawBuf img;
        try { img = loadImage(path); }
        catch (Exception e)
        {
            status.text = to!dstring("画像を読めませんでした: " ~ e.msg);
            return;
        }
        if (img is null)
        {
            status.text = "画像を読めませんでした。"d;
            return;
        }
        scope(exit) destroy(img);
        auto loaded = loadColorTemplate(img);
        session.setTemplate("image:" ~ path, loaded.ink, Mask(CanvasSize, CanvasSize), loaded.color);
        syncingTemplate = true;
        tplCombo.selectedItemIndex = cast(int) catalog.length + 1;
        tplList.selectedItemIndex = cast(int) catalog.length + 1;
        syncingTemplate = false;
        refreshBoards();
        savedThisResult = false;
        status.text = to!dstring("お手本（カラー）: " ~ path);
        refreshTrend();
        updateDiagLive();
    }

    void loadEmbeddedSample()
    {
        auto data = cast(immutable(ubyte)[]) import("sample_house.png");
        auto img = loadImage(data, "sample_house.png");
        if (img is null)
        {
            status.text = "サンプル画像を読めませんでした。"d;
            return;
        }
        scope(exit) destroy(img);
        auto loaded = loadColorTemplate(img);
        session.setTemplate("image:sample_house", loaded.ink, Mask(CanvasSize, CanvasSize), loaded.color);
        refreshBoards();
        savedThisResult = false;
        status.text = "お手本: サンプル家型（線画）"d;
        refreshTrend();
        updateDiagLive();
    }
}

struct LoadedTemplate
{
    Mask ink;
    ubyte[] color;
}

LoadedTemplate loadColorTemplate(ColorDrawBuf img)
{
    int sw = img.width;
    int sh = img.height;
    if (sw < 1)
        sw = 1;
    if (sh < 1)
        sh = 1;
    auto raw = new ubyte[](sw * sh * 4);
    foreach (y; 0 .. sh)
    {
        uint* sl = img.scanLine(y);
        foreach (x; 0 .. sw)
        {
            uint p = sl[x];
            size_t o = (y * sw + x) * 4;
            raw[o] = cast(ubyte)((p >> 16) & 0xFF);
            raw[o + 1] = cast(ubyte)((p >> 8) & 0xFF);
            raw[o + 2] = cast(ubyte)(p & 0xFF);
            raw[o + 3] = 255;
        }
    }
    LoadedTemplate L;
    L.color = fitRgbaToCanvas(raw, sw, sh, CanvasSize);
    L.ink = fromRgbaInk(L.color, CanvasSize, CanvasSize);
    return L;
}
