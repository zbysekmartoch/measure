"use strict";

const { DOMParser } = require("@xmldom/xmldom");
const DocUtils = require("./docUtils");
const ImgManager = require("./imgManager");
const templates = require("./templates");

const MODULE_NAME = "open-xml-templating/docxtemplater-image-module";

// ── PPTX helper ──────────────────────────────────────────────────────────────

function getInnerPptx({ part, left, right, postparsed }) {
  const xmlString = postparsed.slice(left + 1, right).reduce((s, item) => s + item.value, "");
  const xmlDoc = new DOMParser().parseFromString(`<xml>${xmlString}</xml>`);
  part.offset = { x: 0, y: 0 };
  part.ext = { cx: 0, cy: 0 };
  const offset = xmlDoc.getElementsByTagName("a:off");
  const ext = xmlDoc.getElementsByTagName("a:ext");
  if (ext.length > 0) {
    part.ext.cx = parseInt(ext[ext.length - 1].getAttribute("cx"), 10);
    part.ext.cy = parseInt(ext[ext.length - 1].getAttribute("cy"), 10);
  }
  if (offset.length > 0) {
    part.offset.x = parseInt(offset[offset.length - 1].getAttribute("x"), 10);
    part.offset.y = parseInt(offset[offset.length - 1].getAttribute("y"), 10);
  }
  return part;
}

// ── DOCX helper ───────────────────────────────────────────────────────────────

function makeTextToken(text, closeRunBefore, openRunAfter) {
  const spaceAttr = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  const prefix = closeRunBefore ? "</w:r><w:r>" : "";
  const suffix = openRunAfter ? "</w:r><w:r>" : "";
  return { type: "content", value: `${prefix}<w:t${spaceAttr}>${text}</w:t>${suffix}` };
}

// Fix: when {%image} shares a w:t with surrounding text, expandToOne would discard
// that text (leftParts / rightParts are stored but never rendered). We reconstruct
// proper w:r boundaries so each text fragment and each image gets its own run.
function getInnerDocx({ part, leftParts, rightParts }) {
  const beforeText = leftParts
    .filter((p) => p.type === "content")
    .map((p) => p.value)
    .join("");

  const hasRightContent = rightParts.some(
    (p) => p.type === "content" || p.type === "placeholder"
  );

  if (!beforeText && !hasRightContent) {
    // Placeholder is alone in its w:t — original behaviour, no reconstruction needed.
    return part;
  }

  const result = [];

  if (beforeText) {
    // Close the outer run after the before-text, open a new run for the image.
    result.push(makeTextToken(beforeText, false, true));
  }

  result.push(part);

  // Walk rightParts: accumulate text, and give each placeholder its own run.
  let pending = "";
  for (const rp of rightParts) {
    if (rp.type === "content") {
      pending += rp.value;
    } else if (rp.type === "placeholder") {
      if (pending) {
        result.push(makeTextToken(pending, true, true));
        pending = "";
      } else {
        result.push({ type: "content", value: "</w:r><w:r>" });
      }
      result.push(rp);
    }
  }

  if (pending) {
    // Close the previous run, open one for the trailing text; outer </w:r> closes it.
    result.push(makeTextToken(pending, true, false));
  }

  return result;
}

// ── Main module ───────────────────────────────────────────────────────────────

class ImageModule {
  constructor(options = {}) {
    this.name = "ImageModule";
    this.options = options;
    this.imgManagers = {};

    if (this.options.centered == null) this.options.centered = false;
    if (!this.options.getImage) throw new Error("You should pass getImage");
    if (!this.options.getSize) throw new Error("You should pass getSize");

    this.imageNumber = 1;
  }

  optionsTransformer(options, docxtemplater) {
    const relsFiles = docxtemplater.zip
      .file(/\.xml\.rels/)
      .concat(docxtemplater.zip.file(/\[Content_Types\].xml/))
      .map((f) => f.name);
    this.fileTypeConfig = docxtemplater.fileTypeConfig;
    this.fileType = docxtemplater.fileType;
    this.zip = docxtemplater.zip;
    options.xmlFileNames = options.xmlFileNames.concat(relsFiles);
    return options;
  }

  set(options) {
    if (options.zip) this.zip = options.zip;
    if (options.xmlDocuments) this.xmlDocuments = options.xmlDocuments;
  }

  parse(placeHolderContent) {
    if (this.options.setParser) return this.options.setParser(placeHolderContent);

    const type = "placeholder";
    if (placeHolderContent.startsWith("%%")) {
      return { type, value: placeHolderContent.slice(2), module: MODULE_NAME, centered: true };
    }
    if (placeHolderContent.startsWith("%")) {
      return { type, value: placeHolderContent.slice(1), module: MODULE_NAME, centered: false };
    }
    return null;
  }

  postparse(parsed) {
    let expandTo, getInner;
    if (this.fileType === "pptx") {
      expandTo = "p:sp";
      getInner = getInnerPptx;
    } else {
      expandTo = this.options.centered ? "w:p" : "w:t";
      getInner = getInnerDocx;
    }
    return DocUtils.traits.expandToOne(parsed, {
      moduleName: MODULE_NAME,
      getInner,
      expandTo,
    });
  }

  render(part, options) {
    if (!part.type === "placeholder" || part.module !== MODULE_NAME) return null;

    const tagValue = options.scopeManager.getValue(part.value, { part });
    if (!tagValue) return { value: this.fileTypeConfig.tagTextXml };

    if (typeof tagValue === "object" && tagValue.rId && tagValue.sizePixel) {
      return this._getRenderedPart(part, tagValue.rId, tagValue.sizePixel);
    }

    const imgManager = new ImgManager(this.zip, options.filePath, this.xmlDocuments, this.fileType);
    const imgBuffer = this.options.getImage(tagValue, part.value);
    const rId = imgManager.addImageRels(this._nextImageName(), imgBuffer);
    const sizePixel = this.options.getSize(imgBuffer, tagValue, part.value);
    return this._getRenderedPart(part, rId, sizePixel);
  }

  resolve(part, options) {
    if (!part.type === "placeholder" || part.module !== MODULE_NAME) return null;

    const imgManager = new ImgManager(this.zip, options.filePath, this.xmlDocuments, this.fileType);
    const value = options.scopeManager.getValue(part.value, { part });
    if (!value) return { value: this.fileTypeConfig.tagTextXml };

    return Promise.resolve(this.options.getImage(value, part.value)).then((imgBuffer) => {
      const rId = imgManager.addImageRels(this._nextImageName(), imgBuffer);
      return Promise.resolve(this.options.getSize(imgBuffer, value, part.value)).then(
        (sizePixel) => ({ rId, sizePixel })
      );
    });
  }

  _getRenderedPart(part, rId, sizePixel) {
    if (rId !== rId) throw new Error("rId is NaN, aborting"); // isNaN without global
    const size = [
      DocUtils.convertPixelsToEmus(sizePixel[0]),
      DocUtils.convertPixelsToEmus(sizePixel[1]),
    ];
    const centered = this.options.centered || part.centered;
    let xml;
    if (this.fileType === "pptx") {
      const offset = { x: parseInt(part.offset.x, 10), y: parseInt(part.offset.y, 10) };
      const cellCX = parseInt(part.ext.cx, 10) || 1;
      const cellCY = parseInt(part.ext.cy, 10) || 1;
      const imgW = parseInt(size[0], 10) || 1;
      const imgH = parseInt(size[1], 10) || 1;
      if (centered) {
        offset.x = Math.round(offset.x + cellCX / 2 - imgW / 2);
        offset.y = Math.round(offset.y + cellCY / 2 - imgH / 2);
      }
      xml = templates.getPptxImageXml(rId, [imgW, imgH], offset);
    } else {
      xml = centered
        ? templates.getImageXmlCentered(rId, size)
        : templates.getImageXml(rId, size);
    }
    return { value: xml };
  }

  _nextImageName() {
    return `image_generated_${this.imageNumber++}.png`;
  }
}

module.exports = ImageModule;
