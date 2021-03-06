import { Router, Request, Response, NextFunction} from "express";
import { CellRepository } from "../../models/repository/cell";
import { ICellModel } from "../../models/schema/cell";
import { NeuronRepository } from "../../models/repository/neuron";
import Utils from "../utils";
import * as _ from "lodash";

let debug = require("debug")("axone:apiCells");
var cfg = require("../../../config.js");
var oid = require("mongoose").Types.ObjectId;
let router = Router();
let neurons = new NeuronRepository();
let cells = new CellRepository();

function debugRepositoryError(err: any) {
	if (err && err.name === "ValidationError") {
		for (var field in err.errors) {
			if (err.errors.hasOwnProperty(field)) {
				debug(err.errors[field].message);
				break;
			}
		}
	} else {
		if (err) {
			debug(err.message);
		} else {
			debug("unexpected error");
		}
	}
}

interface INameID {
	_id: string;
	name: string;
}

router.use(Utils.ensureAuthenticated);

router.use((req: Request, res: Response, next: NextFunction) => {
	res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	next();
});

function batchUpdateOrCreate(req: Request, res: Response, callback: (error: any, isNew: boolean, result: ICellModel) => void) {
	let userId = Utils.getToken(req);
	if (!userId) {
		return res.status(401).send({error: "token error"});
	}

	if (!req.body.cell) {
		return res.status(400).send({error: "cell field missing"});
	}
	req.body.cell.user = userId;

	if (req.body.cell._id) {
		let selector = {
			_id: req.body.cell._id as string,
			user: userId
		};
		cells.update(selector, req.body.cell, (error, result) => {
			callback(error, false, result);
		});
	} else {
		let cellSelect = _.pick(req.body.cell, ["name", "user"]);
		cells.upsert(cellSelect, req.body.cell, callback);
	}
}

function createBucket(bucketName: string, user: string, callback: (error: any, neuronId: string) => void) {
	cells.model.findOneAndUpdate({name: bucketName, user: user}, null, {new: true, upsert: true, setDefaultsOnInsert: true}).exec()
	.then(cell => {
		neurons.model.findOneAndUpdate({cell: cell._id, user: cell.user}, null, {new: true, upsert: true, setDefaultsOnInsert: true}).exec()
		.then(neuron => {
			callback(null, neuron._id);
		})
		.catch(error => callback(error, null));
	})
	.catch(error => callback(error, null));
}

function genNewDendrites(names: Set<string>, user: string, bucketId: string, callback: (error: any, result: Array<INameID>) => void) {
	let bulk = cells.model.collection.initializeUnorderedBulkOp();
	names.forEach(el => {
		bulk.find({name: el, user: oid(user)}).upsert().update({"$set": {name: el}});
	});
	bulk.execute()
	.then(results => {
		if (!results.ok) {
			return callback(new Error("bulk error in genNewDentrites"), null);
		}
		cells.model.find({user: user, name: { $in: Array.from(names)}}).select("_id").exec()
		.then(ids => {
			let bulk = neurons.model.collection.initializeUnorderedBulkOp();
			for (let el of ids) {
				bulk.find({user: oid(user), cell: oid(el._id), axone: oid(bucketId)}).upsert().update({"$set": {cell: el._id}});
			}
			bulk.execute()
			.then(results => {
				neurons.model.find({user: user, cell: { $in: _.map(ids, "_id")}}).populate("cell").select("_id cell").exec()
				.then(neurons => {
					let result = _.map(neurons, (neuron => {
						return {_id: neuron._id, name: (neuron.cell as any).name};
					}));
					callback(null, result);
				})
				.catch(error => callback(error, null));
			})
			.catch(error => callback(error, null));
		})
		.catch(error => callback(error, null));
	})
	.catch(error => callback(error, null));
}

function prepareDendriteIds(neuronBody: any, user: string, callback: (error: any, result?: Array<INameID>) => void) {

	let buckNewNames = new Set<string>();
	let buckOldIds = new Array<INameID>();
	let needBucket = false;
	if (neuronBody.dendrites) {
		for (let den of neuronBody.dendrites) {
			if (!den._id) {
				needBucket = true;
				buckNewNames.add(den.name);
			} else {
				buckOldIds.push(den);
			}
		}
	}

	if (!needBucket) {
		return callback(null, buckOldIds);
	}

	createBucket("Dendrites", user, (error, neuronId) => {
		genNewDendrites(buckNewNames, user, neuronId, (error, result) => {
			if (error) {
				return callback(error, null);
			}
			let dendrites = _.unionWith(buckOldIds, result, (p1: any, p2: any) => {
				return ((p1._id as string) === (p2._id as string)) || ((p1.name as string) === (p2.name as string));
			});
			return callback(null, dendrites);
		});
	});
}

router.get("/list", (req: Request, res: Response) => {
	try {
		let userId = Utils.getToken(req);
		if (!userId) {
			return res.status(401).send({error: "token error"});
		}
		let selector = {
			user: oid(userId)
		};

		switch (req.query.cat) {
			case "neurons": {
				neurons.model.aggregate([
					{$match: selector},
					{$lookup: {
						from: "cells",
						localField: "cell",
						foreignField: "_id",
						as: "meta"
					}},
					{$project: {_id: 1, name: {$arrayElemAt: ["$meta.name", 0]}}}
					])
				.exec().then((nameids: any) => {
					res.status(200).send(nameids);
				})
				.catch((error: any) => {
					debugRepositoryError(error);
					return res.status(400).send({error: "error"});
				});
			}
			break;
			case "ucells": {
				cells.model.aggregate([
					{$match: selector},
					{$lookup: {
						from: "neurons",
						localField: "_id",
						foreignField: "cell",
						as: "neurons"
					}},
					{$project: {_id: 1, name: 1, neurons: 1}}
					])
				.match({neurons: {$eq: []}})
				.project({_id: 1, name: 1})
				.exec().then((nameids: any) => {
					res.status(200).send(nameids);
				})
				.catch((error: any) => {
					debugRepositoryError(error);
					return res.status(400).send({error: "error"});
				});
			}
			break;
			default: {
				return res.status(400).send({error: "cat error"});
			}
		}
	} catch (e) {
		debug(e);
		return res.status(500).send({error: "error"});
	}
});

router.get("/", (req: Request, res: Response) => {
	try {
		let userId = Utils.getToken(req);
		if (!userId) {
			return res.status(401).send({error: "token error"});
		}
		let selector = {
			user: userId,
			axone: req.query.axone,
		};

		let query = neurons.model.find(selector);

		if (Number(req.query.limit) && Number(req.query.page)) {
			query = query.skip(Number(req.query.limit) * (Number(req.query.page) - 1)).limit(Number(req.query.limit));
		}

		query.populate([
			{path: "axone", select: "_id name"},
			{path: "cell", select: "-user"},
			{path: "dendrites", select: "_id cell", populate: {path: "cell", select: "_id name"}}
			]).lean().exec()
		.then(raw => {
			let result = [];

			let neurons = raw as Array<any>;
			if (neurons) {
				for (let neuron of neurons as Array<any>) {
					let item: any = {
						_id: neuron.cell._id,
						name: neuron.cell.name,
						__neuron: neuron._id
					};
					if (neuron.dendrites) {
						item.__dendrites = [];
						for (let dendrite of neuron.dendrites) {
							item.__dendrites.push({
								_id: dendrite._id,
								name: dendrite.cell.name
							});
						}
					}
					result.push(item);
				}
			}
			res.status(200).send(result);
		})
		.catch(error => {
			debugRepositoryError(error);
			return res.status(400).send({error: "error"});
		});
	} catch (e) {
		debug(e);
		return res.status(500).send({error: "error"});
	}
});

router.post("/", (req: Request, res: Response) => {
	try {
		batchUpdateOrCreate(req, res, (errorCell, isNewCell, cellResult) => {
			if (errorCell || !cellResult) {
				debugRepositoryError(errorCell);
				return res.status(400).send({error: "error"});
			}

			if (req.body.neuron) {
				req.body.neuron.user = cellResult.user;
				req.body.neuron.cell = cellResult._id;

				prepareDendriteIds(req.body.neuron, cellResult.user, (error2, dendrites) => {
					if (error2 || !dendrites) {
						debugRepositoryError(error2);
						return res.status(400).send({error: "error"});
					}

					dendrites = _.uniqBy(dendrites, "_id");
					req.body.neuron.dendrites = _.map(dendrites, "_id");
					let neuronSelect = _.pick(req.body.neuron, ["cell", "user", "axone"]);
					neurons.upsert(neuronSelect, req.body.neuron, (errorNeuron, isNewNeuron, neuronResult) => {
						if (errorNeuron || !neuronResult) {
							debugRepositoryError(errorNeuron);
							return res.status(400).send({error: "error"});
						}

						return res.status((isNewNeuron || isNewCell) ? 201 : 200).send({
							cell: cellResult,
							neuronId: neuronResult._id,
							axone: neuronResult.axone,
							dendrites: dendrites
						});
					});

				});
			}
		});
	} catch (e) {
		debug(e);
		return res.status(500).send({error: "error in your request"});
	}
});

export { router as ItemsRoute };