module engine.types;

import std.algorithm : min, max;
import std.math : sqrt;

enum int CanvasSize = 768;
enum float DefaultStrokeWidth = 6.0f;

struct Point
{
    float x;
    float y;
    float pressure = 1.0f;
    uint timeMs = 0;
}

struct Stroke
{
    Point[] points;
}

struct TemplateDef
{
    string id;
    string labelJa;
    string kind; // "shape" or "image"
}

struct Metrics
{
    float iou = 0;
    float chamferUserToTpl = 0;
    float chamferTplToUser = 0;
    float missRate = 0; // template pixels not covered
    float extraRate = 0; // user pixels not on template
    float dx = 0;
    float dy = 0;
    float scaleRatio = 1;
    float aspectRatio = 1;
    float angleDeg = 0;
    float jitter = 0;
    float coverTL = 0, coverTR = 0, coverBL = 0, coverBR = 0;
}

struct Diagnosis
{
    Metrics metrics;
    string[] commentsJa;
}

struct SessionRecord
{
    string isoTime;
    string templateId;
    string alignMode;
    Metrics metrics;
    string[] commentsJa;
}

enum AlignMode
{
    none,
    centroid
}

enum OverlayMode
{
    overlay,
    diff,
    heat,
    wipe
}
