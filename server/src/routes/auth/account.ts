import moment = require("moment");
import { Request, Response } from "express";
import { UserRepository } from "../../models/repository/user";
import jwt = require("jwt-simple");
import Utils from "../utils";

var cfg = require("../../../config.js");
var debug = require("debug")("axone:auth");

export default class {
	constructor(private repo: UserRepository) {}

	private debugRepositoryError(err: any) {
		if (err && err.name === "ValidationError") {
			for (var field in err.errors) {
				if (err.errors.hasOwnProperty(field)) {
					debug(err.errors[field].message);
					break;
				}
			}
		} else {
			debug(err.message);
		}
	}

	private tokenize(userId: string): string {
		let payload = {
			sub: userId,
			iat: moment().unix(),
			exp: moment().add(14, "days").unix()
		};

		return jwt.encode(payload, cfg.secret);
	}

	signup(req: Request, res: Response) {
		this.repo.findOne({email: req.body.email}, null, null, (err, oldUser) => {
			if (oldUser) {
				return res.status(409).send({error: "email already exists"});
			}

			this.repo.create(req.body, (err2, newUser) => {
				if (err2) {
					this.debugRepositoryError(err2);
					return res.status(400).send({error: "error"});
				}
				return res.status(201).send({token: this.tokenize(newUser._id)});
			});
		});
	}

	login(req: Request, res: Response) {
		this.repo.findOne({email: req.body.email}, "+password", null, (err, user) => {
			if (!user) {
				return res.status(401).send({error: "wrong email or password"});
			}
			user.comparePassword(req.body.password, (err2, isMatch) => {
				if (!isMatch) {
					return res.status(401).send({error: "wrong email or password"});
				}

				return res.status(200).send({token: this.tokenize(user._id)});
			});
		});
	}

	get(req: Request, res: Response) {
		let userId = Utils.getToken(req);
		if (!userId) {
			return res.status(401).send({error: "token error"});
		}
		let selector = {
			_id: userId
		};
		this.repo.findOne(selector, null, null, (err, user) => {
			if (!user) {
				return res.status(404).send({error: "User not found"});
			}
			return res.status(200).send(user);
		});
	}

	update(req: Request, res: Response) {
		let userId = Utils.getToken(req);
		if (!userId) {
			return res.status(401).send({error: "token error"});
		}
		let selector = {
			_id: userId
		};
		this.repo.update(selector, req.body, (err, user) => {
			if (err) {
				return res.status(400).send({error: "error"});
			}
			return res.status(200).send(user);
		});
	}
}