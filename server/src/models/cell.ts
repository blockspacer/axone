/// <reference path="../_all.d.ts" />
"use strict";

import { Document, Schema, model} from "mongoose";
import { RepositoryBase } from "./base/repository";

var debug = require("debug")("ax-server:cell");

export interface ICellModel extends Document {
	name: string;
	user: string;
	properties: Object;
	createdAt: Date;
	modifiedAt: Date;
};

let entitySchema = new Schema({
	name: 		{ type: String, 						required: true},
	user: 		{ type: Schema.Types.ObjectId, 	required: true, ref: "user"},
	properties:	{ type: Schema.Types.Mixed,		required: false},
	createdAt: 	{ type: Date, 							required: false},
	modifiedAt: { type: Date, 							required: false}
});

entitySchema.index({user: 1, name: 1}, {unique: true});

entitySchema.pre("save", function(next: () => void) {
	if (!this._doc) {
		next();
		return this;
	}

	let doc = <ICellModel>this._doc;
	let now = new Date();
	if (!doc.createdAt) {
		doc.createdAt = now;
	}
	doc.modifiedAt = now;

	next();
	return this;
});

let modelSchema = model<ICellModel>("cell", entitySchema, "cells", true);

modelSchema.on("index", function(err: any) {
	debug(err);
});

export class CellRepository extends RepositoryBase<ICellModel> {
	constructor() {
		super(modelSchema);
	}

	update(selector: {_id: string, user: string}, item: ICellModel, callback: (err: any, res: ICellModel) => void) {
		this._model.findOneAndUpdate(selector, item, {new: true, runValidators: true}, callback);
	}

	delete(selector: {_id: string, user: string}, callback: (err: any, res: any) => void) {
		this._model.remove(selector, (err) => callback(err, null));
	}
}