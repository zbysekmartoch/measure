"use strict";

const DocUtils = require("./docUtils");

const extensionRegex = /[^.]+\.([^.]+)/;

const rels = {
  getPrefix(fileType) {
    return fileType === "docx" ? "word" : "ppt";
  },
  getFileTypeName(fileType) {
    return fileType === "docx" ? "document" : "presentation";
  },
  getRelsFileName(fileName) {
    return fileName.replace(/^.*?([a-zA-Z0-9]+)\.xml$/, "$1") + ".xml.rels";
  },
  getRelsFilePath(fileName, fileType) {
    const relsFileName = rels.getRelsFileName(fileName);
    const prefix = fileType === "pptx" ? "ppt/slides" : "word";
    return `${prefix}/_rels/${relsFileName}`;
  },
};

class ImgManager {
  constructor(zip, fileName, xmlDocuments, fileType) {
    this.fileName = fileName;
    this.prefix = rels.getPrefix(fileType);
    this.zip = zip;
    this.xmlDocuments = xmlDocuments;
    this.fileTypeName = rels.getFileTypeName(fileType);
    this.mediaPrefix = fileType === "pptx" ? "../media" : "media";
    const relsFilePath = rels.getRelsFilePath(fileName, fileType);
    this.relsDoc = xmlDocuments[relsFilePath] || this._createEmptyRelsDoc(xmlDocuments, relsFilePath);
  }

  _createEmptyRelsDoc(xmlDocuments, relsFileName) {
    const mainRels = `${this.prefix}/_rels/${this.fileTypeName}.xml.rels`;
    const doc = xmlDocuments[mainRels];
    if (!doc) {
      const err = new Error("Could not copy from empty relsdoc");
      err.properties = { mainRels, relsFileName, files: Object.keys(this.zip.files) };
      throw err;
    }
    const relsDoc = DocUtils.str2xml(DocUtils.xml2str(doc));
    const relationships = relsDoc.getElementsByTagName("Relationships")[0];
    const children = relationships.getElementsByTagName("Relationship");
    for (let i = 0, l = children.length; i < l; i++) {
      relationships.removeChild(children[i]);
    }
    xmlDocuments[relsFileName] = relsDoc;
    return relsDoc;
  }

  _loadMaxRid() {
    const iterable = this.relsDoc.getElementsByTagName("Relationship");
    return Array.prototype.reduce.call(iterable, (max, rel) => {
      const id = rel.getAttribute("Id");
      if (/^rId[0-9]+$/.test(id)) {
        return Math.max(max, parseInt(id.slice(3), 10));
      }
      return max;
    }, 0);
  }

  addExtensionRels(contentType, extension) {
    const contentTypeDoc = this.xmlDocuments["[Content_Types].xml"];
    const defaultTags = contentTypeDoc.getElementsByTagName("Default");
    const registered = Array.prototype.some.call(defaultTags, (tag) =>
      tag.getAttribute("Extension") === extension
    );
    if (registered) return;
    const types = contentTypeDoc.getElementsByTagName("Types")[0];
    const newTag = contentTypeDoc.createElement("Default");
    newTag.namespaceURI = null;
    newTag.setAttribute("ContentType", contentType);
    newTag.setAttribute("Extension", extension);
    types.appendChild(newTag);
  }

  addImageRels(imageName, imageData, i = 0) {
    const realImageName = i === 0 ? imageName : `${imageName}(${i})`;
    const imagePath = `${this.prefix}/media/${realImageName}`;
    if (this.zip.files[imagePath] != null) {
      return this.addImageRels(imageName, imageData, i + 1);
    }
    this.zip.file(imagePath, imageData, { binary: true });
    const extension = realImageName.replace(extensionRegex, "$1");
    this.addExtensionRels(`image/${extension}`, extension);
    const relationships = this.relsDoc.getElementsByTagName("Relationships")[0];
    const newTag = this.relsDoc.createElement("Relationship");
    newTag.namespaceURI = null;
    const maxRid = this._loadMaxRid() + 1;
    newTag.setAttribute("Id", `rId${maxRid}`);
    newTag.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
    newTag.setAttribute("Target", `${this.mediaPrefix}/${realImageName}`);
    relationships.appendChild(newTag);
    return maxRid;
  }
}

module.exports = ImgManager;
