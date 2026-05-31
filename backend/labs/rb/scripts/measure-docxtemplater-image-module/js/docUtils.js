"use strict";

const DocUtils = require("docxtemplater").DocUtils;

DocUtils.convertPixelsToEmus = (pixel) => Math.round(pixel * 9525);

module.exports = DocUtils;
